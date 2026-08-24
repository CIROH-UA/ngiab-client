"""Convert a model run's ngen output CSVs to consolidated parquet.

One parquet per schema group instead of per catchment, to cut file count and overhead.
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
        """Give the run its manifest, because converting without one leaves it invisible."""
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
        """Write t-route to parquet in the shape the readers pin."""
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
        """Catchments keyed by their column set."""
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
        """One parquet holding every catchment that shares this column set."""
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
