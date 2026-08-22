"""Distill one model run into the manifest the read path consults.

    tethys manage write_manifest --path /var/lib/tethys_persist/ngiab_visualizer/<name>

Idempotent: the version token is derived from the run's own outputs rather than minted, so
re-running against an unchanged run rewrites byte-identical files. Unit 7's backfill leans on
that, because it runs on every container start.

This command is the seam the launcher and the ingest worker both go through, so a run gains
its manifest the same way whichever put it there. Like convert_outputs, it is a one-shot
against a directory and touches no database.
"""

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

        document = manifest.distill(
            run_path,
            run_id=options["id"],
            label=options["label"],
            created=options["created"],
            legacy_uuids=options["legacy_uuids"],
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
