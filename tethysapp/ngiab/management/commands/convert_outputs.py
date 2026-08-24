"""Convert a model run's ngen output CSVs to consolidated parquet.

One parquet per *schema group* rather than one per catchment. Measured on 2,000 catchments
x 100 timesteps: 3.2 MB across 2,000 files against 0.1 MB in one, because per-file parquet
metadata dominates when the files are small; the value matrix goes from 90.1 ms to 3.1 ms and
a schema read from 24.2 ms to 0.8 ms. Reading one catchment costs 0.3 ms more, which is the
whole price.

That settles a question the plan left open: the two access patterns -- one catchment across
all time, and one variable across all catchments -- were expected to pull in opposite
directions. Sorted by (catchment_id, Time) they do not.

Against object storage the size and the timings matter less than the count. A per-catchment
layout makes the value matrix one GET per catchment; consolidated it is one.

Grouped by schema, not merged with union_by_name, because catchments produced by different
formulations write different columns. Merging them pads the narrow ones with NULLs and makes
every catchment report the union, which changes what the variable picker offers for that
catchment. One file per distinct column set keeps each catchment's own answer intact.

Original CSVs are left in place, as before: nothing here removes anything, and a run that has
not been converted still reads from csv. The earlier per-catchment parquet conversion this
replaces measured 438 MB of csv down to 65 MB (6.7x) and a two-column read from 35 ms to
9 ms; consolidating keeps both of those and adds the count reduction on top.
"""

import os

from django.core.management.base import BaseCommand, CommandError

from tethysapp.ngiab import duckdb_conn

CONSOLIDATED_PREFIX = "catchments-"

TROUTE_PARQUET = "troute.parquet"


class Command(BaseCommand):
    help = "Consolidate a model run's ngen CSV outputs into parquet, grouped by schema."

    def add_arguments(self, parser):
        parser.add_argument("--path", required=True, help="Run directory (as seen in the container)")
        parser.add_argument("--compression", default="zstd")

    def handle(self, *args, **options):
        run_path = options["path"].rstrip("/")
        outputs = os.path.join(run_path, "outputs", "ngen")

        if not os.path.isdir(outputs):
            raise CommandError(f"No ngen outputs directory at {outputs}")

        csvs = sorted(
            f for f in os.listdir(outputs) if f.startswith("cat-") and f.endswith(".csv")
        )
        if not csvs:
            self.stdout.write("Nothing to convert (no catchment CSV outputs).")
            return

        groups = self._group_by_schema(outputs, csvs)
        compression = options["compression"].upper()
        written = 0

        for index, (columns, members) in enumerate(sorted(groups.items())):
            destination = os.path.join(outputs, f"{CONSOLIDATED_PREFIX}{index}.parquet")
            self._write_group(outputs, destination, members, columns, compression)
            written += 1
            self.stdout.write(f"  group {index}: {len(members)} catchments, {len(columns)} columns")

        self.stdout.write(
            self.style.SUCCESS(
                f"consolidated {len(csvs)} catchment files into {written} parquet object(s)"
            )
        )

        self._convert_troute(run_path, compression)
        self._write_manifest(run_path)

    def _write_manifest(self, run_path):
        """Give the run its manifest, because converting without one leaves it invisible.

        A directory under the storage root is only a *registered* run once it has a manifest,
        and this command is what the launcher runs on import. Converting the outputs and then
        not recording them meant a freshly imported run did not appear in the picker at all --
        found by running the built image rather than by any test, because every test wrote the
        manifest itself.
        """
        from tethysapp.ngiab import manifest

        document = manifest.distill(run_path)
        manifest.write(run_path, document)
        self.stdout.write(
            self.style.SUCCESS(
                f"wrote manifest: {document['catchment_count']} catchments, "
                f"token {document['version_token'][:12]}"
            )
        )

    def _convert_troute(self, run_path, compression):
        """Write t-route to parquet in the shape the readers pin.

        Uncached and whole-file before this: xr.open_dataset(...).to_dataframe() loaded every
        feature and every timestep to plot one channel, twice per chart load, because the
        variable list and the series are separate requests.

        The schema is pinned here rather than inherited from the source, because the source
        shapes disagree -- NetCDF yields a MultiIndex keyed on feature_id, csv a flat frame
        with featureID and current_time -- and the readers used to branch on which. A
        converted run matched neither branch and returned an empty chart with no error.
        """
        from tethysapp.ngiab import utils as ngiab_utils

        troute_dir = os.path.join(run_path, "outputs", "troute")
        if not os.path.isdir(troute_dir):
            return

        sources = sorted(
            name for name in os.listdir(troute_dir)
            if name.endswith((".csv", ".nc")) and name != TROUTE_PARQUET
        )
        if not sources:
            self.stdout.write("  no troute output to convert")
            return

        source = os.path.join(troute_dir, sources[0])
        suffix = os.path.splitext(source)[1]
        frame = ngiab_utils._normalised_troute_frame(source, suffix)  # noqa: SLF001

        destination = os.path.join(troute_dir, TROUTE_PARQUET)
        connection = duckdb_conn.connect_isolated()
        try:
            connection.register("troute_frame", frame)
            connection.execute(
                f"COPY (SELECT * FROM troute_frame) TO {duckdb_conn.quote(destination)} "
                f"(FORMAT PARQUET, COMPRESSION {compression})"
            )
        finally:
            connection.close()

        self.stdout.write(f"  troute: {len(frame)} rows from {sources[0]}")

    def _group_by_schema(self, outputs, csvs):
        """Catchments keyed by their column set.

        A run whose catchments came from one formulation -- the ordinary case -- produces a
        single group and a single file. The grouping exists for the run that does not.
        """
        groups = {}
        for name in csvs:
            stem = name[: -len(".csv")]
            path = os.path.join(outputs, name)
            header = duckdb_conn.query(
                f"SELECT * FROM read_csv_auto({duckdb_conn.quote(path)}) LIMIT 0"
            )
            groups.setdefault(tuple(header.columns), []).append(stem)
        return groups

    def _write_group(self, outputs, destination, members, columns, compression):
        """One parquet holding every catchment that shares this column set.

        ``catchment_id`` is appended rather than prepended: the readers treat column 0 as the
        step and column 1 as the timestamp, so putting it first would shift that contract.
        Appended, it is excluded by name the way the synthesised ``filename`` column already
        was.

        Sorted by (catchment_id, time) so a single-catchment read hits contiguous row groups
        and the value matrix still scans once.
        """
        pattern = os.path.join(outputs, "cat-*.csv")
        selected = ", ".join(duckdb_conn.quote_identifier(column) for column in columns)
        members_list = ", ".join(duckdb_conn.quote(member) for member in members)
        time_column = columns[1] if len(columns) > 1 else columns[0]

        duckdb_conn.query(
            f"""
            COPY (
                SELECT {selected},
                       regexp_extract(filename, '(cat-[0-9]+)', 1) AS catchment_id
                FROM read_csv_auto({duckdb_conn.quote(pattern)}, filename=true, union_by_name=true)
                WHERE regexp_extract(filename, '(cat-[0-9]+)', 1) IN ({members_list})
                ORDER BY catchment_id, {duckdb_conn.quote_identifier(time_column)}
            ) TO {duckdb_conn.quote(destination)}
            (FORMAT PARQUET, COMPRESSION {compression})
            """
        )
