"""Distill one model run into the manifest the read path consults.

Idempotent: re-running against an unchanged run rewrites byte-identical files.
"""

import json
import os

from django.core.management.base import BaseCommand, CommandError

from tethysapp.ngiab import manifest


class Command(BaseCommand):
    help = "Write the manifest for an NGIAB model run."

    def add_arguments(self, parser):
        parser.add_argument("--path", required=True, help="Run directory as seen in the container")
        parser.add_argument("--label", default=None, help="Display name (defaults to the directory name)")
        parser.add_argument("--id", default=None, help="Run id (defaults to the directory name)")
        parser.add_argument("--created", default=None, help="ISO 8601 timestamp for picker ordering")
        parser.add_argument(
            "--legacy-uuid",
            action="append",
            default=[],
            dest="legacy_uuids",
            help="A pre-manifest UUID this run answered to; repeatable, since one directory "
            "could carry several registry rows",
        )

    def handle(self, *args, **options):
        run_path = options["path"].rstrip("/")
        if not os.path.isdir(run_path):
            raise CommandError(f"Not a directory: {run_path}")

        label = options["label"]
        legacy_uuids = list(options["legacy_uuids"])
        if not label or not legacy_uuids:
            carried = self._from_legacy_registry(run_path)
            if carried:
                label = label or carried.get("label")
                if not legacy_uuids and carried.get("id"):
                    legacy_uuids = [carried["id"]]
                self.stdout.write(
                    f"  carried over from ngiab_visualizer.json: "
                    f"label {carried.get('label')!r}, id {carried.get('id')!r}"
                )

        document = manifest.distill(
            run_path,
            run_id=options["id"],
            label=label,
            created=options["created"],
            legacy_uuids=legacy_uuids,
        )
        manifest.write(run_path, document)

        self.stdout.write(
            self.style.SUCCESS(
                f"wrote manifest for {document['label']}: "
                f"{document['catchment_count']} catchments, "
                f"{document['crosswalk_count']} flowpaths, "
                f"format {document['output_format'] or 'none'}, "
                f"token {document['version_token'][:12]}"
            )
        )
        if document["bounds"] is None:
            self.stdout.write(
                self.style.WARNING("  no GeoPackage bounds: the map cannot frame this run")
            )
        if document["output_format"] is None:
            self.stdout.write(
                self.style.WARNING("  no catchment outputs: there is nothing to plot")
            )

    def _from_legacy_registry(self, run_path):
        """This run's row in the pre-manifest registry, if that file is still beside it.

        The earlier version kept runs in ngiab_visualizer.json at the storage root. Nothing
        reads it now, so without this an upgrade quietly renames every run to its directory
        and breaks the links they were shared under -- the two things the file still holds.
        """
        registry = os.path.join(os.path.dirname(run_path), "ngiab_visualizer.json")
        try:
            with open(registry) as handle:
                rows = (json.load(handle) or {}).get("model_runs") or []
        except (OSError, ValueError):
            return None

        wanted = os.path.basename(run_path)
        for row in rows:
            stored = str(row.get("path") or "").rstrip("/")
            if stored and os.path.basename(stored) == wanted:
                return row
        return None
