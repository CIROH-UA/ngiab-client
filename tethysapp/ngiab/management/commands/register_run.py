"""Register (or remove) an NGIAB model run in the database.

The database is the only registry, so the launcher goes through this command in a one-shot
container to add a run:

    docker run --rm <mounts> <image> \
        tethys manage register_run --path /var/lib/tethys_persist/ngiab_visualizer/<name> \
                                   --label <name>

Idempotent on ``--path``: re-registering the same directory updates the existing row rather
than accumulating duplicates, so re-running the launcher is safe.
"""

import os
import uuid

from django.core.management.base import BaseCommand, CommandError

from tethysapp.ngiab.utils import teehr_name_from_manifest


class Command(BaseCommand):
    help = "Register an NGIAB model run in the database."

    def add_arguments(self, parser):
        # Not required here: --list takes no path, and argparse would refuse it first.
        parser.add_argument("--path", help="Run directory as seen inside the container")
        parser.add_argument("--label", default=None, help="Display name (defaults to the directory name)")
        parser.add_argument("--id", default=None, help="Explicit UUID (defaults to a new one)")
        parser.add_argument("--subset", default="")
        parser.add_argument(
            "--teehr-configuration-name",
            default=None,
            help="Overrides the value read from the run's teehr_run_manifest.json",
        )
        parser.add_argument("--remove", action="store_true", help="Remove runs at --path instead")
        parser.add_argument("--list", action="store_true", help="List registered runs and exit")

    def handle(self, *args, **options):
        from tethysapp.ngiab.models import ModelRun

        if options["list"]:
            for run in ModelRun.objects.all():
                self.stdout.write(f"{run.id}\t{run.label}\t{run.path}")
            return

        if not options["path"]:
            raise CommandError("--path is required unless --list is given")

        path = options["path"].rstrip("/")

        if options["remove"]:
            deleted, _ = ModelRun.objects.filter(path=path).delete()
            self.stdout.write(self.style.SUCCESS(f"Removed {deleted} run(s) at {path}"))
            return

        label = options["label"] or os.path.basename(path)

        teehr_name = options["teehr_configuration_name"]
        if teehr_name is None:
            teehr_name = teehr_name_from_manifest(path)

        run_id = options["id"]
        if run_id:
            try:
                uuid.UUID(str(run_id))
            except ValueError as exc:
                raise CommandError(f"--id must be a UUID: {run_id}") from exc

        defaults = {
            "label": label,
            "subset": options["subset"] or "",
            "teehr_configuration_name": teehr_name or "",
        }
        if run_id:
            defaults["path"] = path
            run, created = ModelRun.objects.update_or_create(id=run_id, defaults=defaults)
        else:
            run, created = ModelRun.objects.update_or_create(path=path, defaults=defaults)

        verb = "Registered" if created else "Updated"
        self.stdout.write(self.style.SUCCESS(f"{verb} {run.label} ({run.id})"))
        self.stdout.write(str(run.id))
