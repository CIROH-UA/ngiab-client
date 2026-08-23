"""Publish an uploaded archive as a run, out of process.

    tethys manage ingest_archive --job <id> --name <run-name>
    tethys manage ingest_archive --archive /path/to/run.tar.gz --name <run-name>

The controller launches the first form with subprocess and returns immediately. It has to be
out of process rather than a thread: the image serves on one uvicorn worker by default, and
converting an 8,105-catchment run holds the GIL through DuckDB and pandas long enough that
the portal would stop answering. A separate process also means a conversion that dies takes
its own memory with it.

The second form is here because the same pipeline is worth having from a shell -- an operator
with the archive already on the machine should not have to round-trip it through the bucket.

Every exit path writes a terminal status, including the unexpected ones. A job whose status
stays "running" forever is indistinguishable to the client from one that is genuinely slow,
and the client polls until it sees a terminal state.
"""

import traceback

from django.core.management.base import BaseCommand, CommandError

from tethysapp.ngiab import archive, ingest


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

        try:
            path = local_archive or self._staged(job_id)
            published = ingest.publish(path, run_name, job_id=job_id, progress=progress)
        except archive.ArchiveRejected as exc:
            self._fail(job_id, run_name, str(exc))
            raise CommandError(str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 - a job must never end without a status
            self.stderr.write(traceback.format_exc())
            self._fail(job_id, run_name, f"The run could not be published: {exc}")
            raise CommandError(str(exc)) from exc
        finally:
            if job_id:
                ingest.discard_staged(job_id)

        if job_id:
            ingest.write_status(job_id, state=ingest.DONE, stage="done",
                                message=f"{published} is ready", run=published)
        self.stdout.write(self.style.SUCCESS(f"published {published}"))

    def _staged(self, job_id):
        import os
        import tempfile

        handle, path = tempfile.mkstemp(prefix=f"ngiab-{job_id}-", suffix=".archive")
        os.close(handle)
        return ingest.fetch_staged(job_id, path)

    def _fail(self, job_id, run_name, message):
        if job_id:
            ingest.write_status(job_id, state=ingest.FAILED, stage="failed",
                                message=message, run=run_name)
