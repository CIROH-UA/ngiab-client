"""Write a manifest for every run the database still registers.

Runs from the entrypoint before ``tethys db migrate``, since migration 0003 drops the table.
"""

import os

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from tethysapp.ngiab import manifest, run_store

REGISTRY_TABLE = "ngiab_modelrun"


class Command(BaseCommand):
    help = "Write manifests for runs still registered in the database."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be written without writing anything",
        )

    def handle(self, *args, **options):
        rows = self._registry_rows()
        if rows is None:
            self.stdout.write("no registry table; nothing to backfill")
            return

        if not rows:
            self.stdout.write("registry table is empty; nothing to backfill")
            return

        grouped = self._group_by_directory(rows)
        root = os.path.realpath(run_store.local_root())

        written = skipped = outside = missing = 0
        for directory, entry in sorted(grouped.items()):
            if not os.path.isdir(directory):
                missing += 1
                self.stderr.write(
                    self.style.WARNING(
                        f"  registered directory no longer exists, skipping: {directory}"
                    )
                )
                continue

            if not self._inside_root(directory, root):
                outside += 1
                self.stderr.write(
                    self.style.WARNING(
                        f"  outside the storage root, will not be listed: {directory}\n"
                        f"    move or copy it under {run_store.local_root()} to keep it"
                    )
                )
                continue

            if options["dry_run"]:
                self.stdout.write(f"  would write manifest for {directory}")
                skipped += 1
                continue

            try:
                self._write_one(directory, entry)
            except OSError as exc:
                raise CommandError(
                    f"Could not write a manifest into {directory}: {exc}. Refusing to "
                    "continue -- dropping the registry with manifests missing would lose "
                    "these runs."
                ) from exc
            except Exception as exc:  # noqa: BLE001 - one bad run must not lose the others
                skipped += 1
                self.stderr.write(
                    self.style.WARNING(f"  could not distil {directory}: {exc}")
                )
                continue
            written += 1

        self._report(written, skipped, outside, missing)

    def _registry_rows(self):
        """Every registry row, or None when the table is gone."""
        if REGISTRY_TABLE not in connection.introspection.table_names():
            return None

        with connection.cursor() as cursor:
            cursor.execute(
                f"SELECT id, label, path, teehr_configuration_name, created "  # noqa: S608
                f"FROM {REGISTRY_TABLE}"
            )
            columns = [column[0] for column in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]

    def _group_by_directory(self, rows):
        """Collapse rows onto directories, keeping every id each directory answered to."""
        root = os.path.realpath(run_store.local_root())
        grouped = {}
        for row in rows:
            directory = self._resolve(str(row["path"]).rstrip("/"), root)
            entry = grouped.setdefault(
                directory, {"uuids": [], "label": None, "teehr": "", "created": None}
            )
            entry["uuids"].append(manifest.normalize_uuid(row["id"]))
            entry["label"] = entry["label"] or row.get("label")
            entry["teehr"] = entry["teehr"] or (row.get("teehr_configuration_name") or "")
            created = row.get("created")
            if created and (entry["created"] is None or str(created) < str(entry["created"])):
                entry["created"] = created
        return grouped

    def _resolve(self, stored, root):
        """Where a registered run actually is now, which may not be where the row says."""
        stored_real = os.path.realpath(stored)
        if os.path.isdir(stored_real):
            return stored_real

        candidate = os.path.join(root, os.path.basename(stored_real))
        if os.path.isdir(candidate):
            self.stdout.write(
                f"  {os.path.basename(stored_real)}: registered as {stored}, found in the "
                "storage root"
            )
            return os.path.realpath(candidate)
        return stored_real

    def _inside_root(self, directory, root):
        """Whether a registered directory is somewhere the listing will ever look."""
        return directory == root or directory.startswith(root + os.sep)

    def _write_one(self, directory, entry):
        """Distil one run, preserving anything an existing manifest already knows."""
        existing = manifest.read(directory) or {}
        uuids = list(dict.fromkeys(list(existing.get("legacy_uuids") or []) + entry["uuids"]))

        created = existing.get("created") or self._isoformat(entry["created"])
        document = manifest.distill(
            directory,
            run_id=existing.get("id") or os.path.basename(directory),
            label=existing.get("label") or entry["label"] or os.path.basename(directory),
            created=created,
            legacy_uuids=uuids,
            teehr_configuration_name=(existing.get("teehr") or {}).get("configuration_name")
            or entry["teehr"],
        )
        manifest.write(directory, document)

    def _isoformat(self, value):
        return value.isoformat() if hasattr(value, "isoformat") else (str(value) if value else None)

    def _report(self, written, skipped, outside, missing):
        self.stdout.write(
            self.style.SUCCESS(
                f"backfill complete: {written} written, {skipped} skipped, "
                f"{outside} outside the storage root, {missing} missing"
            )
        )
        if outside:
            self.stdout.write(
                self.style.WARNING(
                    f"  {outside} registered run(s) live outside the storage root and will "
                    "stop appearing once the registry is removed. Move them under "
                    f"{run_store.local_root()} before upgrading again."
                )
            )
