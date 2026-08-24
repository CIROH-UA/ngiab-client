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
    """How often a working job re-stamps its status.

    Derived from the staleness window rather than configured separately, because the only
    thing that matters is that it is comfortably shorter. A quarter of the window leaves
    three beats of margin before a live job looks dead; the cap of a minute takes over above
    a four-minute window, and at the default of thirty minutes it is the cap that governs --
    a beat a minute, thirty beats of margin, and a job writing no more often than a person
    would refresh.

    The floor is small rather than a whole second: a second was longer than the entire window
    for anyone who had turned NGIAB_JOB_STALE_SECONDS right down, which would have quietly
    defeated the heartbeat in exactly the configuration that most wanted it.
    """
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
    """Record where a job has got to. Last write wins, except over a finished one.

    Three writers, not one: the stage transitions in ``publish``, the heartbeat beside them,
    and the terminal DONE/FAILED that the management command writes once ``publish`` returns
    -- from the same process but outside the heartbeat's scope.

    ``only_if_running`` is what the heartbeat passes. Stopping the beat is a request, not a
    guarantee: ``join`` takes a timeout, and a beat already inside a slow ``save`` outlives
    it, so a RUNNING write could land after DONE and resurrect a finished job as a running
    one that then goes stale and reads as failed. Checking the stored state first costs one
    read per beat -- once a minute at the default -- and makes the ordering not matter.
    """
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
    """Put ``body`` at ``key``, with no moment where nothing is there.

    This used to delete and then save, which left a window -- short, but real, and entered
    on every single status update -- in which a poll arriving between the two read no status
    at all and was answered "no such upload job". A heartbeat multiplies the number of writes
    by the length of the job, so it would have turned a rare wrong answer into a common one.

    Which branch runs is decided by ``path()`` raising: Django's base ``Storage`` defines it
    for every backend, so a ``hasattr`` check answers yes even for S3 and discriminates
    nothing. ``S3Storage.path`` raises ``NotImplementedError`` -- measured, not assumed.

    ``S3Storage`` overwrites on save, so the delete was never needed there.
    ``FileSystemStorage`` refuses to, inventing ``status_a1b2c3.json`` beside the original --
    which is why the delete existed. The local path writes a temporary file in the same
    directory and ``os.replace``s it over the target instead: atomic within a filesystem, and
    a reader sees either the old bytes or the new ones.
    """
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
    """This job's last recorded state, or None when there is no such job.

    A job that stopped reporting is reported failed here rather than in storage; see
    _fail_if_stale.
    """
    return _fail_if_stale(_load(job_id))


def _load(job_id):
    """The status exactly as it was written, with no staleness verdict applied.

    Separate from read_status because the terminal guard below has to compare against what
    the writer actually recorded. Feeding it a synthesised failure would let a stale-looking
    job block its own heartbeat.

    Opened rather than probed first, the same way run_store._read_manifest does it. A client
    polls this every two seconds for the length of a job, so an exists() ahead of the open
    doubled the round trips for the whole of a conversion.
    """
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


@contextlib.contextmanager
def _heartbeat(job_id, snapshot):
    """Keep a working job's ``updated`` advancing while a stage is in progress.

    Staleness is the only evidence available that a job died: nothing supervises the child,
    and a SIGKILL writes no status. But it was measuring the wrong thing. Status was written
    only at stage boundaries, and ``convert_outputs`` is one blocking call -- so a run large
    enough to convert for longer than the window was declared dead *while it was working*.
    The client stopped polling and reported failure; the job then published anyway, so the
    run appeared after the interface said it had not. A user who reacted by uploading again
    under the same name put two ingests on one destination.

    The beat says nothing new. It rewrites the stage the job is already in, so the only field
    that changes is the timestamp, and staleness goes back to meaning what it claims to:
    nothing is running any more.

    A daemon thread rather than progress reporting inside the conversion, because this has to
    hold for every long step -- including the object-by-object upload, and whichever step
    turns out to be slow next -- rather than only the one that is slow today.

    The thread is joined rather than merely signalled on the way out, but a join takes a
    timeout and a beat inside a slow write outlives it -- so the ordering is not relied on.
    ``write_status(only_if_running=True)`` is what actually prevents a late beat putting
    RUNNING back over DONE; the join just makes it rare enough not to matter.

    The loop swallows its own errors. A beat thread that dies on one bad write stops
    reporting, which is precisely the state this exists to prevent.
    """
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
    """Extract, convert, distil and publish one archive as ``run_name``.

    Returns the published run's name. Raises ArchiveRejected for anything the user can fix
    and IngestError for anything they cannot.
    """
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

    Cleanup deletes the keys this call actually wrote rather than re-listing the prefix.
    Re-listing would also sweep whatever a *concurrent* upload of the same name had put
    there, turning one job's failure into another's corruption.

    Mutual exclusion between two uploads of one name is ``run_store.claimed``'s job, not
    this function's. The manifest check just below is kept anyway: it is the only protection
    left on a store that does not implement the conditional write the claim relies on, where
    claiming degrades to a no-op.
    """
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
    """Run ``put`` over every item concurrently: ``(keys written, first failure or None)``.

    Every upload is awaited before the caller sees a failure, which is why the failure is
    returned rather than raised. ``Executor.map``'s iterator cancels the futures it has not
    yielded once it is abandoned, so raising at the first error left siblings either
    cancelled or still in flight -- and one still in flight writes its object *after* the
    cleanup has already swept the prefix.
    """
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
    key = staging_key(job_id)
    try:
        if backend.exists(key):
            backend.delete(key)
    except Exception:  # noqa: BLE001 - staging litter is not worth failing a job over
        logger.warning("Could not discard staged archive for %s", job_id, exc_info=True)
