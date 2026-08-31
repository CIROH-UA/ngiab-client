"""Publish an uploaded archive as a run, out of process.

Runs conversion in a separate process so a large run cannot block the portal's one worker.
"""

import logging
import os
import tempfile
import traceback

from django.core.management.base import BaseCommand, CommandError

from tethysapp.ngiab import archive, ingest

logger = logging.getLogger(__name__)

_UPLOAD_TEMP_PREFIX = "ngiab-"


def _is_upload_temp(path):
    base = os.path.basename(path or "")
    return base.startswith(_UPLOAD_TEMP_PREFIX) and base.endswith(".archive") \
        and os.path.dirname(path or "") == tempfile.gettempdir()


class Command(BaseCommand):
    help = "Extract, convert and publish an uploaded archive as a model run."

    def add_arguments(self, parser):
        parser.add_argument("--job", help="Job id whose staged archive to publish")
        parser.add_argument("--archive", help="A local archive, instead of a staged one")
        parser.add_argument("--name", required=True, help="Name to publish the run under")

    def handle(self, *args, **options):
        job_id = options.get("job")
        local_archive = options.get("archive")
        run_name = options["name"]

        if not job_id and not local_archive:
            raise CommandError("Pass either --job or --archive.")

        def progress(stage, message):
            self.stdout.write(f"  {stage}: {message}")
            if job_id:
                ingest.write_status(job_id, state=ingest.RUNNING, stage=stage,
                                    message=message, run=run_name)

        if job_id:
            ingest.write_status(job_id, state=ingest.RUNNING, stage="starting",
                                message="preparing the upload", run=run_name)

        path = None
        try:
            path = local_archive or self._staged(job_id)
            published = ingest.publish(path, run_name, job_id=job_id, progress=progress)
        except archive.ArchiveRejected as exc:
            self._fail(job_id, run_name, str(exc))
            raise CommandError(str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 - a job must never end without a status
            # Both destinations on purpose. logger reaches the portal's configured logging
            # wherever this runs; stderr is what a person sees running the command by hand,
            # and what the launching process captures for a detached run. The status message
            # stays a fixed sentence, so neither of these is a duplicate of it.
            logger.exception("Could not publish %s", run_name)
            self.stderr.write(traceback.format_exc())
            self._fail(job_id, run_name, "The run could not be published.")
            raise CommandError(str(exc)) from exc
        finally:
            if job_id:
                ingest.discard_staged(job_id)
                if path and (path != local_archive or _is_upload_temp(path)):
                    self._discard_local(path)

        if job_id:
            ingest.write_status(job_id, state=ingest.DONE, stage="done",
                                message=f"{published} is ready", run=published)
        self.stdout.write(self.style.SUCCESS(f"published {published}"))

    def _discard_local(self, path):
        """Remove a temp archive that the upload left behind on disk."""
        try:
            os.remove(path)
        except OSError:
            logger.warning("Could not remove the temporary archive %s", path, exc_info=True)

    def _staged(self, job_id):
        handle, path = tempfile.mkstemp(prefix=f"ngiab-{job_id}-", suffix=".archive")
        os.close(handle)
        return ingest.fetch_staged(job_id, path)

    def _fail(self, job_id, run_name, message):
        if job_id:
            ingest.write_status(job_id, state=ingest.FAILED, stage="failed",
                                message=message, run=run_name)
