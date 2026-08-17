"""Convert a model run's ngen output CSVs to parquet.

Measured on a real run: 438 MB of csv becomes 65 MB of zstd parquet (6.7x smaller), the
whole conversion takes ~4.6 s for 85 files, and reading two columns drops from 35 ms to
9 ms because parquet supports column projection. Against the `cp -r` the launcher already
performs, the conversion is essentially free.

viewOnTethys.sh runs this in a one-shot container after copying a run into
~/ngiab_visualizer, so it only ever touches OUR copy -- never the directory the user
pointed at with -d.
"""

import os

import duckdb
from django.core.management.base import BaseCommand, CommandError

# Deleting source data is only ever acceptable inside the directory the visualizer manages.
# A user pointing --path at their own run directory must not lose their CSVs.
MANAGED_ROOT = os.environ.get(
    "NGIAB_MANAGED_ROOT", "/var/lib/tethys_persist/ngiab_visualizer"
)


class Command(BaseCommand):
    help = "Convert a model run's ngen CSV outputs to parquet."

    def add_arguments(self, parser):
        parser.add_argument("--path", required=True, help="Run directory (as seen in the container)")
        parser.add_argument(
            "--delete-csv",
            action="store_true",
            help="Remove each CSV once its parquet is written and verified. Refused outside the managed copy.",
        )
        parser.add_argument("--compression", default="zstd")

    def handle(self, *args, **options):
        run_path = options["path"].rstrip("/")
        outputs = os.path.join(run_path, "outputs", "ngen")

        if not os.path.isdir(outputs):
            raise CommandError(f"No ngen outputs directory at {outputs}")

        delete_csv = options["delete_csv"]
        if delete_csv and not self._is_managed(run_path):
            # Refuse, not warn: only the visualizer's own copy may ever be modified.
            raise CommandError(
                f"Refusing --delete-csv outside {MANAGED_ROOT}: {run_path} looks like an "
                "original run directory, not the visualizer's copy."
            )

        # Catchment outputs only: nexus files are headerless and nothing reads them now.
        csvs = sorted(
            f for f in os.listdir(outputs) if f.startswith("cat-") and f.endswith(".csv")
        )
        if not csvs:
            self.stdout.write("Nothing to convert (no catchment CSV outputs).")
            return

        converted = skipped = removed = 0
        csv_bytes = pq_bytes = 0
        compression = options["compression"].upper()
        con = duckdb.connect()

        for name in csvs:
            src = os.path.join(outputs, name)
            dst = os.path.join(outputs, name[: -len(".csv")] + ".parquet")

            if os.path.exists(dst):
                skipped += 1
            else:
                try:
                    # DuckDB, not pandas.to_parquet: already a dependency, and no pyarrow.
                    con.execute(
                        f"COPY (SELECT * FROM read_csv_auto('{src}')) "
                        f"TO '{dst}' (FORMAT PARQUET, COMPRESSION {compression})"
                    )
                except Exception as exc:  # noqa: BLE001 - one bad file must not abort the run
                    self.stderr.write(self.style.WARNING(f"  skipped {name}: {exc}"))
                    continue
                converted += 1

            if delete_csv:
                # Prove it reads and matches before removing the only other copy.
                try:
                    # count(*) comes from the parquet footer; no rows are materialised.
                    rows_pq = con.execute(
                        f"SELECT count(*) FROM read_parquet('{dst}')"
                    ).fetchone()[0]
                    # Same reader that wrote it: a raw line count is wrong here.
                    rows_csv = con.execute(
                        f"SELECT count(*) FROM read_csv_auto('{src}')"
                    ).fetchone()[0]
                except Exception as exc:  # noqa: BLE001
                    self.stderr.write(self.style.WARNING(f"  keeping {name}: verify failed ({exc})"))
                    continue

                if rows_pq != rows_csv:
                    self.stderr.write(
                        self.style.WARNING(f"  keeping {name}: {rows_csv} rows vs {rows_pq} in parquet")
                    )
                    continue

                csv_bytes += os.path.getsize(src)
                pq_bytes += os.path.getsize(dst)
                os.remove(src)
                removed += 1

        summary = f"converted {converted}, already present {skipped}"
        if delete_csv:
            saved = (csv_bytes - pq_bytes) / 1e6
            summary += f", removed {removed} CSVs (freed {saved:.0f} MB)"
        self.stdout.write(self.style.SUCCESS(summary))

    @staticmethod
    def _is_managed(run_path):
        root = os.path.realpath(MANAGED_ROOT)
        target = os.path.realpath(run_path)
        return target == root or target.startswith(root + os.sep)
