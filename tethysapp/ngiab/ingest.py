"""Turn an uploaded archive into a run the picker lists.

Extracts, converts, distils a manifest, and publishes the result, hosted or local.
"""

import contextlib
import json
import logging
import os
import posixpath
import re
import shutil
import tempfile
import threading
import time

from . import archive, duckdb_conn, manifest, run_store

logger = logging.getLogger(__name__)

PENDING = "pending"
RUNNING = "running"
DONE = "done"
FAILED = "failed"
TERMINAL = (DONE, FAILED)

UPLOAD_CONCURRENCY = int(os.environ.get("NGIAB_UPLOAD_CONCURRENCY", "10"))

STALE_AFTER_SECONDS = float(os.environ.get("NGIAB_JOB_STALE_SECONDS", 30 * 60))


def heartbeat_seconds():
    """How often a working job re-stamps its status, derived from the staleness window."""
    return min(60.0, max(0.05, STALE_AFTER_SECONDS / 4))


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


def write_status(job_id, *, only_if_running=False, **fields):
    """Record where a job has got to. Last write wins, except over a finished one."""
    if only_if_running:
        current = _load(job_id)
        if current and current.get("state") in TERMINAL:
            logger.debug("Not re-stamping %s; it has already finished", job_id)
            return current

    payload = {"job": job_id, "updated": time.time(), **fields}
    try:
        _replace(run_store.storage(), status_key(job_id),
                 json.dumps(payload).encode("utf-8"))
    except Exception:  # noqa: BLE001 - a lost status update must not kill the job
        logger.warning("Could not write status for job %s", job_id, exc_info=True)
    return payload


def _replace(backend, key, body):
    """Put ``body`` at ``key``, atomically and with no moment where nothing is there."""
    try:
        target = backend.path(key)
    except NotImplementedError:
        target = None

    if target is None:
        from django.core.files.base import ContentFile

        backend.save(key, ContentFile(body))
        return

    directory = os.path.dirname(target)
    os.makedirs(directory, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(handle, "wb") as sink:
            sink.write(body)
        os.replace(temporary, target)
    except BaseException:
        with contextlib.suppress(OSError):
            os.remove(temporary)
        raise


def read_status(job_id):
    """This job's last recorded state, or None when there is no such job."""
    return _fail_if_stale(_load(job_id))


def _load(job_id):
    """The status exactly as it was written, with no staleness verdict applied."""
    backend = run_store.storage()
    key = status_key(job_id)
    try:
        with backend.open(key) as handle:
            payload = handle.read()
    except FileNotFoundError:
        return None
    except Exception as exc:  # noqa: BLE001
        raise run_store.StorageUnreachable(str(exc)) from exc

    if isinstance(payload, bytes):
        payload = payload.decode("utf-8")
    try:
        return json.loads(payload)
    except ValueError:
        return None


def _fail_if_stale(document):
    """Report a job that stopped reporting as failed, rather than leaving it pending."""
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


@contextlib.contextmanager
def _heartbeat(job_id, snapshot):
    """Keep a working job's ``updated`` advancing while a stage is in progress."""
    if not job_id:
        yield
        return

    stop = threading.Event()

    def beat():
        while not stop.wait(heartbeat_seconds()):
            if stop.is_set():
                return
            try:
                write_status(job_id, only_if_running=True, state=RUNNING, **snapshot())
            except Exception:  # noqa: BLE001 - a thread that dies here reopens the bug
                logger.warning("Heartbeat for %s could not report", job_id, exc_info=True)

    thread = threading.Thread(target=beat, name=f"ngiab-heartbeat-{job_id}", daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=heartbeat_seconds() + 5)
        if thread.is_alive():
            logger.error("Heartbeat for %s did not stop; storage is likely wedged", job_id)


def publish(archive_path, run_name, *, job_id=None, progress=None):
    """Extract, convert, distil and publish one archive as ``run_name``."""
    at = {"fields": {"stage": "starting", "message": "preparing the upload", "run": run_name}}

    def say(stage, message):
        at["fields"] = {"stage": stage, "message": message, "run": run_name}

        logger.info("[ingest %s] %s", job_id or "-", message)
        if progress:
            progress(stage, message)

    if not is_valid_name(run_name):
        raise archive.ArchiveRejected(
            f"{run_name!r} is not a usable run name. Use letters, numbers, dots, dashes and "
            "underscores, starting with a letter or a digit."
        )
    workspace = _workspace()
    try:
        with run_store.claimed(run_name):
            if run_store.find(run_name) is not None:
                raise archive.ArchiveRejected(
                    f"A run called {run_name!r} already exists. Delete it first, or upload "
                    "under another name."
                )
            with _heartbeat(job_id, lambda: at["fields"]):
                return _run_stages(archive_path, run_name, workspace, say)
    except run_store.ClaimHeld as exc:
        raise archive.ArchiveRejected(str(exc)) from exc
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


def _run_stages(archive_path, run_name, workspace, say):
    """The stages themselves, lifted out so publish can wrap them in one heartbeat."""
    from django.core.management import call_command

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


def _workspace():
    """A scratch directory for one ingest."""
    if duckdb_conn.is_object_storage():
        return tempfile.mkdtemp(prefix="ngiab-ingest-")

    staging = os.path.join(run_store.local_root(), run_store.STAGING_DIR)
    os.makedirs(staging, exist_ok=True)
    return tempfile.mkdtemp(prefix="ingest-", dir=staging)


def _publish_directory(source, run_name):
    """Put the prepared run where the picker will find it, all at once or not at all."""
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
    """Upload one prepared run, manifest last, cleaning up if it does not finish."""
    from django.core.files.base import File

    backend = run_store.storage()
    manifest_key = posixpath.join(run_name, manifest.MANIFEST_NAME)

    def put(relative, path):
        key = posixpath.join(run_name, relative)
        with open(path, "rb") as handle:
            backend.save(key, File(handle))
        return key

    body = {
        relative: path
        for relative, path in _files_under(source).items()
        if relative != manifest.MANIFEST_NAME
    }

    written = []
    try:
        uploaded, failure = _upload_all(put, body)
        written.extend(uploaded)
        if failure is not None:
            raise failure

        if backend.exists(manifest_key):
            raise archive.ArchiveRejected(
                f"A run called {run_name!r} was published while this one was uploading."
            )
        local_manifest = os.path.join(source, manifest.MANIFEST_NAME)
        if os.path.isfile(local_manifest):
            written.append(put(manifest.MANIFEST_NAME, local_manifest))
    except Exception:
        logger.warning("Publishing %s failed; removing what it wrote", run_name)
        try:
            run_store.delete_prefix(backend, run_name, keys=written)
        except Exception:  # noqa: BLE001 - the original failure is the one worth raising
            logger.warning("Could not clean up the partial run %s", run_name, exc_info=True)
        raise


def _files_under(source):
    """Every file in the prepared run, as ``{run-relative posix path: local path}``."""
    found = {}
    for root, _dirs, files in os.walk(source):
        for name in files:
            path = os.path.join(root, name)
            found[os.path.relpath(path, source).replace(os.sep, "/")] = path
    return found


def _upload_all(put, items):
    """Run ``put`` over every item concurrently: ``(keys written, first failure or None)``."""
    from concurrent.futures import ThreadPoolExecutor

    written = []
    failure = None
    with ThreadPoolExecutor(max_workers=UPLOAD_CONCURRENCY) as pool:
        futures = [pool.submit(put, relative, path) for relative, path in items.items()]
        for future in futures:
            try:
                written.append(future.result())
            except Exception as exc:  # noqa: BLE001 - the first one is returned, not raised
                failure = failure or exc
    return written, failure


def fetch_staged(job_id, destination):
    """Bring the uploaded archive out of storage onto local disk."""
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
    key = staging_key(job_id)
    try:
        if backend.exists(key):
            backend.delete(key)
    except Exception:  # noqa: BLE001 - staging litter is not worth failing a job over
        logger.warning("Could not discard staged archive for %s", job_id, exc_info=True)
