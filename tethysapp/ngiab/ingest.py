"""Turn an uploaded archive into a run the picker lists.

The pipeline is the same either way -- extract, convert, distil a manifest, publish -- and
only the transfer differs. Hosted, the browser PUTs the archive straight into the bucket with
a presigned URL and the server fetches it back; locally it arrives as a plain upload. Neither
the bytes nor the conversion go through the request that starts the job, because the image
serves on one uvicorn worker by default (ASGI_PROCESSES=1): a conversion done inline stops the
whole portal for its duration, and an 8,105-catchment run is minutes, not seconds.

**Conversion needs a filesystem.** convert_outputs reads with os.listdir and writes beside the
inputs, so a hosted ingest is necessarily fetch -> extract -> convert -> upload -> discard,
with transient disk of roughly the unpacked size. That is the cost of reusing one conversion
path for both backends rather than maintaining an object-store variant of it.

**The run's id is stamped from the name it is published under**, not from whatever the
archive's top-level directory happened to be called. Everywhere else in this app the two are
the same only by accident -- distill takes the id from the basename of the path it is handed
-- and on object storage the prefix and the id can drift apart, at which point the picker
offers an id that resolves to nothing. Ingest is the one place that controls both, so it sets
them equal.

Status is written through the storage backend rather than kept in memory: the job runs in a
subprocess, so the process answering the poll is not the process doing the work. Those status
objects are small and are not swept up: a few hundred bytes per upload, under a reserved
prefix the run listing skips.
"""

import json
import logging
import os
import posixpath
import re
import shutil
import tempfile
import time

from . import archive, duckdb_conn, manifest, run_store

logger = logging.getLogger(__name__)

#: Job states. TERMINAL ones stop the client polling.
PENDING = "pending"
RUNNING = "running"
DONE = "done"
FAILED = "failed"
TERMINAL = (DONE, FAILED)

#: Objects uploaded at once when publishing a run. Bounded because this shares a host with
#: the portal; concurrent because each PUT is a round trip and a run is many small objects.
UPLOAD_CONCURRENCY = int(os.environ.get("NGIAB_UPLOAD_CONCURRENCY", "16"))

#: How long a job may go without a status update before it is presumed dead.
#:
#: A SIGKILL -- an OOM kill is the likely one, since conversion is the memory-hungry part --
#: skips the command's except and finally, so nothing writes a terminal status and the client
#: polls a job that will never move. Nothing supervises the child, so staleness is the only
#: signal available. Generous, because a large conversion is legitimately quiet for minutes:
#: progress is reported per stage, not per catchment.
STALE_AFTER_SECONDS = float(os.environ.get("NGIAB_JOB_STALE_SECONDS", 30 * 60))


#: What a newly published run may be called.
#:
#: Stricter than run_store._is_plain_name, deliberately. That guard exists to refuse a name
#: that is not one path component, and it has to keep accepting whatever an operator already
#: named a directory. Uploading *chooses* the name, so it can insist on one that reads well
#: in a URL and an object key: no spaces, no leading dot, nothing that needs escaping.
NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def is_valid_name(name):
    """Whether ``name`` is acceptable for a run being created now."""
    return bool(name) and bool(NAME_PATTERN.match(name)) and not name.startswith("_")


class IngestError(RuntimeError):
    """The archive was fine but the run could not be published."""


def _key(*parts):
    return posixpath.join(run_store.STAGING_DIR, *parts)


def staging_key(job_id):
    """Where the archive for this job is uploaded to, inside the storage root."""
    return _key(job_id, "archive")


def status_key(job_id):
    return _key(job_id, "status.json")


# ---- Status, readable from a process that is not doing the work -------------


def write_status(job_id, **fields):
    """Record where a job has got to. Last write wins; there is one writer."""
    from django.core.files.base import ContentFile

    payload = {"job": job_id, "updated": time.time(), **fields}
    backend = run_store.storage()
    key = status_key(job_id)
    try:
        if backend.exists(key):
            backend.delete(key)
        backend.save(key, ContentFile(json.dumps(payload).encode("utf-8")))
    except Exception:  # noqa: BLE001 - a lost status update must not kill the job
        logger.warning("Could not write status for job %s", job_id, exc_info=True)
    return payload


def read_status(job_id):
    """This job's last recorded state, or None when there is no such job."""
    backend = run_store.storage()
    key = status_key(job_id)
    try:
        if not backend.exists(key):
            return None
        with backend.open(key) as handle:
            payload = handle.read()
    except Exception as exc:  # noqa: BLE001
        raise run_store.StorageUnreachable(str(exc)) from exc

    if isinstance(payload, bytes):
        payload = payload.decode("utf-8")
    try:
        document = json.loads(payload)
    except ValueError:
        return None
    return _fail_if_stale(document)


def _fail_if_stale(document):
    """Report a job that stopped reporting as failed, rather than leaving it pending.

    Read-side rather than written by anything: the process that would have written a
    terminal status is precisely the one that is gone.
    """
    if not isinstance(document, dict):
        return None
    if document.get("state") in TERMINAL:
        return document

    updated = document.get("updated")
    if not isinstance(updated, (int, float)):
        return document
    if time.time() - updated <= STALE_AFTER_SECONDS:
        return document

    minutes = int(STALE_AFTER_SECONDS // 60)
    return {
        **document,
        "state": FAILED,
        "stage": "failed",
        "message": (
            f"This upload stopped responding with no result for over {minutes} minutes, "
            "so it is being reported as failed. Nothing was published."
        ),
    }


# ---- The pipeline -----------------------------------------------------------


def publish(archive_path, run_name, *, job_id=None, progress=None):
    """Extract, convert, distil and publish one archive as ``run_name``.

    Returns the published run's name. Raises ArchiveRejected for anything the user can fix
    and IngestError for anything they cannot.
    """
    from django.core.management import call_command

    def say(stage, message):
        logger.info("[ingest %s] %s", job_id or "-", message)
        if progress:
            progress(stage, message)

    if not is_valid_name(run_name):
        raise archive.ArchiveRejected(
            f"{run_name!r} is not a usable run name. Use letters, numbers, dots, dashes and "
            "underscores, starting with a letter or a digit."
        )
    if run_store.find(run_name) is not None:
        raise archive.ArchiveRejected(
            f"A run called {run_name!r} already exists. Delete it first, or upload under "
            "another name."
        )

    workspace = _workspace()
    try:
        say("extracting", "unpacking the archive")
        unpacked = archive.extract(archive_path, os.path.join(workspace, "run"))

        say("converting", "converting outputs to parquet")
        try:
            call_command("convert_outputs", "--path", unpacked)
        except Exception as exc:  # noqa: BLE001
            raise IngestError(f"The run's outputs could not be converted: {exc}") from exc

        say("describing", "writing the manifest")
        document = manifest.distill(unpacked, run_id=run_name, label=run_name)
        if not document.get("catchment_count"):
            raise archive.ArchiveRejected(
                "The run has no catchment outputs, so there would be nothing to plot."
            )
        manifest.write(unpacked, document)

        say("publishing", f"copying {document['catchment_count']} catchments into storage")
        _publish_directory(unpacked, run_name)

        run_store.clear_caches()
        manifest.clear_caches()
        say("done", f"{run_name} is ready")
        return run_name
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


def _workspace():
    """A scratch directory for one ingest.

    Under the storage root rather than /tmp when the runs live on a filesystem, because
    publishing is then a rename within one filesystem -- atomic, and instant regardless of
    the run's size. From /tmp it was a cross-device ``shutil.move``: a recursive copy that
    is not atomic despite the docstring that claimed it was, and that exposes a
    half-populated directory under the run's final name while it runs.

    The staging directory is reserved (``_uploads``), so a run being assembled is never
    listed as a run.
    """
    if duckdb_conn.is_object_storage():
        return tempfile.mkdtemp(prefix="ngiab-ingest-")

    staging = os.path.join(run_store.local_root(), run_store.STAGING_DIR)
    os.makedirs(staging, exist_ok=True)
    return tempfile.mkdtemp(prefix="ingest-", dir=staging)


def _publish_directory(source, run_name):
    """Put the prepared run where the picker will find it, all at once or not at all.

    Locally that is ``os.rename`` within the storage root: atomic, and it fails rather than
    merging when the name is taken, which is the claim that the check in ``publish`` cannot
    make on its own -- two uploads of the same name can both pass that check before either
    writes.

    Hosted there is no atomic rename and no transaction. What there is instead is ordering:
    every object goes up first and ``manifest.json`` goes up last, because a directory under
    the storage root is only a *registered* run once it has one. A crash partway leaves a
    prefix the picker does not offer, and the partial objects are removed on the way out.
    """
    if not duckdb_conn.is_object_storage():
        os.makedirs(run_store.local_root(), exist_ok=True)
        destination = os.path.join(run_store.local_root(), run_name)
        try:
            os.rename(source, destination)
        except OSError as exc:
            if os.path.exists(destination):
                raise archive.ArchiveRejected(
                    f"A run called {run_name!r} appeared while this one was being prepared."
                ) from exc
            raise
        return

    _upload_directory(source, run_name)


def _upload_directory(source, run_name):
    """Upload one prepared run, manifest last, cleaning up if it does not finish.

    Concurrent because a run is many small objects and each PUT is a round trip: serially,
    an 8,105-catchment run's config, forcing and restart files are thousands of sequential
    requests. Bounded because this runs beside a portal on one worker.

    Every upload is awaited before the first failure is re-raised. ``Executor.map``'s
    iterator cancels the futures it has not yielded once it is abandoned, so raising at the
    first error left siblings either cancelled or still in flight -- and one still in flight
    writes its object *after* the cleanup has already swept the prefix.
    """
    from concurrent.futures import ThreadPoolExecutor
    from django.core.files.base import File

    backend = run_store.storage()
    manifest_relative = manifest.MANIFEST_NAME
    payload = []
    for root, _dirs, files in os.walk(source):
        for name in files:
            path = os.path.join(root, name)
            relative = os.path.relpath(path, source).replace(os.sep, "/")
            payload.append((path, relative))

    body = [item for item in payload if item[1] != manifest_relative]
    tail = [item for item in payload if item[1] == manifest_relative]

    def put(item):
        path, relative = item
        with open(path, "rb") as handle:
            backend.save(posixpath.join(run_name, relative), File(handle))

    try:
        # All awaited before any failure is raised; see the docstring for why.
        with ThreadPoolExecutor(max_workers=UPLOAD_CONCURRENCY) as pool:
            futures = [pool.submit(put, item) for item in body]
            failure = None
            for future in futures:
                try:
                    future.result()
                except Exception as exc:  # noqa: BLE001 - the first one is re-raised below
                    failure = failure or exc
        if failure is not None:
            raise failure
        for item in tail:
            put(item)
    except Exception:
        logger.warning("Publishing %s failed; removing the partial run", run_name)
        try:
            run_store._delete_prefix(backend, run_name)  # noqa: SLF001
        except Exception:  # noqa: BLE001 - the original failure is the one worth raising
            logger.warning("Could not clean up the partial run %s", run_name, exc_info=True)
        raise


def fetch_staged(job_id, destination):
    """Bring the uploaded archive out of storage onto local disk.

    Streamed rather than read whole: the archive is the largest single thing this app
    handles, and the point of the presigned upload was that it never had to fit anywhere.
    """
    backend = run_store.storage()
    key = staging_key(job_id)
    if not backend.exists(key):
        raise IngestError(
            "The uploaded archive is not in storage. The upload may not have finished."
        )
    with backend.open(key) as source, open(destination, "wb") as sink:
        shutil.copyfileobj(source, sink, length=8 * 1024 * 1024)
    return destination


def discard_staged(job_id):
    """Remove the staged archive. Called whether the job succeeded or not."""
    backend = run_store.storage()
    for key in (staging_key(job_id),):
        try:
            if backend.exists(key):
                backend.delete(key)
        except Exception:  # noqa: BLE001 - staging litter is not worth failing a job over
            logger.warning("Could not discard staged archive for %s", job_id, exc_info=True)
