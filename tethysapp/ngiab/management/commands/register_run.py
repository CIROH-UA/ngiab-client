"""Register (or remove) an NGIAB model run in the database.

viewOnTethys.sh used to append an entry to ngiab_visualizer.json directly, which worked
because the file lives on the host and the app only read it. Now that the database owns the
registry, the launcher goes through this command in a one-shot container instead:

    docker run --rm <mounts> <image> \
        tethys manage register_run --path /var/lib/tethys_persist/ngiab_visualizer/<name> \
                                   --label <name>

Idempotent on ``--path``: re-registering the same directory updates the existing row rather
than accumulating duplicates, so re-running the launcher is safe.
"""

import json
import os
import uuid

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Register an NGIAB model run in the database."

    def add_arguments(self, parser):
        parser.add_argument("--path", required=True, help="Run directory as seen inside the container")
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

        # Import first: a non-empty table stops the lazy import and hides older runs.
        if not ModelRun.objects.exists():
            from tethysapp.ngiab.utils import _import_runs_from_json_once

            _import_runs_from_json_once()

        path = options["path"].rstrip("/")

        if options["remove"]:
            deleted, _ = ModelRun.objects.filter(path=path).delete()
            self.stdout.write(self.style.SUCCESS(f"Removed {deleted} run(s) at {path}"))
            return

        label = options["label"] or os.path.basename(path)

        teehr_name = options["teehr_configuration_name"]
        if teehr_name is None:
            teehr_name = self._teehr_name_from_manifest(path)

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

    @staticmethod
    def _teehr_name_from_manifest(path):
        """Read the producer's authoritative configuration name, if it travelled with the run.

        _resolve_configuration_name can derive this from the directory name, but a persisted
        value from the manifest always wins, so it is captured at registration time.
        """
        manifest = os.path.join(path, "teehr_run_manifest.json")
        if not os.path.exists(manifest):
            return ""
        try:
            with open(manifest, "r") as f:
                return json.load(f).get("configuration_name", "") or ""
        except (OSError, ValueError):
            return ""
