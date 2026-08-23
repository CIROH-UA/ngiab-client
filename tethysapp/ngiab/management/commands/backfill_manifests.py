"""Write a manifest for every run the database still registers.

    tethys manage backfill_manifests

Runs from the entrypoint on every start, before ``tethys db migrate``, because migration
0003 drops the table this reads. Idempotent by construction: the version token is derived
from a run's own outputs rather than minted, so an unchanged run rewrites byte-identical
files and a second start does nothing.

**Reads the table with raw SQL, not the ORM.** The model is deleted in the same release that
drops the table, and an operator upgrading from a pre-manifest image straight to a
post-removal one is exactly the person who needs this to work -- an ``ImportError`` on
``models.ModelRun`` would lose every registration they had, silently, in the one upgrade path
that cannot be retried. Raw SQL also means the command keeps working when the app is not in
INSTALLED_APPS.

**Not migration code.** Distilling a run reads its GeoPackage and a crosswalk of tens of
thousands of rows; inside 0003 that would execute during ``tethys db migrate`` in the
entrypoint, blocking startup with no progress output and no bound, and leaving a container
that never serves if any of it failed.

Failure is non-fatal on purpose, with one exception. A run that cannot be distilled is
reported and skipped so the rest still land; an unwritable storage root aborts, because
continuing would drop the table in Unit 8 with nothing written to replace it.
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
        """Every registry row, or None when the table is gone.

        Raw SQL: see the module docstring. ``created`` is selected because the run picker
        ordered by it and a storage listing is lexicographic, so losing it would change which
        run loads by default.
        """
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
        """Collapse rows onto directories, keeping every id each directory answered to.

        ``ModelRun.path`` was deliberately not unique -- its own comment records that the same
        directory is legitimately registered more than once, once per import. Several rows
        therefore become one manifest, and every one of their UUIDs has to survive or the
        share links minted against the others break.
        """
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
        """Where a registered run actually is now, which may not be where the row says.

        A registry row holds whatever path was passed at registration, and that path can be
        stale in two ordinary ways: it may be a *host* path that never existed inside the
        container, or the runs may since have been mounted somewhere else. Both leave a row
        pointing at nothing while the run itself sits in the storage root under the same
        name.

        Found by running the real upgrade against a real database: all five rows held host
        paths, every one was reported missing, and the migration then dropped the table --
        losing the ids that keep shared links working, for runs that were present the whole
        time. Matching on the directory name inside the root recovers them.

        The stored path still wins when it resolves, so a deployment whose paths are correct
        is unaffected.
        """
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
        """Whether a registered directory is somewhere the listing will ever look.

        Not an exotic case. ``NGIAB_SCAN_ROOTS`` exists so a deployment can register runs from
        other mounts, so an upgrading install may well have several -- and after the registry
        is dropped, a directory outside the root is a run that simply stops appearing.
        """
        return directory == root or directory.startswith(root + os.sep)

    def _write_one(self, directory, entry):
        """Distil one run, preserving anything an existing manifest already knows.

        A manifest may already be present -- ingest writes one, and this command may have run
        before. Merging rather than overwriting means a re-run cannot narrow what is known:
        ids accumulate, and the earliest ``created`` wins so ordering does not drift.
        """
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
