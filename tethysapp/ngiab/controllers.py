from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_POST
from django.urls import reverse
import functools
import glob
import logging
import os
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import duckdb
from tethys_sdk.routing import controller
from tethys_sdk.permissions import has_permission
from . import duckdb_conn, ingest, run_store
from .utils import (
    UnknownModelRun,
    model_run_exists,
    run_outputs,
    _read_output_frame,
    _read_output_columns,
    getCatchmentsIds,
    check_troute_id,
    get_troute_vars,
    get_troute_df,
    parse_troute_feature_id,
    describe_troute_feature,
    troute_variable_note,
    TROUTE_MISSING,
    TROUTE_FEATURE_COLUMN,
    TROUTE_TIME_COLUMN,
    getCatchmentsList,
    run_bounds_4326,
    get_model_runs_selectable,
    get_catchment_variables,
    get_catchment_value_matrix,
    build_series_payload,
    to_epoch_seconds,
    _DEFAULT_MAX_POINTS,
    teehr_source,
)

logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024



UPLOAD_URL_TTL_SECONDS = 6 * 60 * 60

# The portal owns sign-in, at the site root rather than under the app, so the pair is the same
# whether this app is the whole portal or one of many. Both are resolved rather than written
# down: Tethys rewrites LOGIN_URL when PREFIX_URL is set (settings.py) and reverses logout
# through the accounts namespace, so a hardcoded logout would 404 on a prefixed portal while
# sign-in kept working.
LOGOUT_URL_FALLBACK = "/accounts/logout/"


def logout_url():
    """Where the portal logs a user out, following a URL prefix if it has one."""
    from django.urls import NoReverseMatch, reverse as reverse_url

    try:
        return reverse_url("accounts:logout")
    except NoReverseMatch:
        logger.warning("accounts:logout does not reverse; falling back to a literal path")
        return LOGOUT_URL_FALLBACK


def signed_in(request):
    """Whether this request carries an authenticated user."""
    user = getattr(request, "user", None)
    return bool(user and user.is_authenticated)


def _may(request, permission):
    """Whether this request's user holds one app permission, failing closed on error."""
    if not signed_in(request):
        return False
    if getattr(request.user, "is_superuser", False):
        return True
    try:
        return bool(has_permission(request, permission))
    except Exception:  # noqa: BLE001 - see the docstring: any failure denies
        logger.exception("Could not evaluate the %s permission", permission)
        return False


def may_manage_runs(request):
    """Whether this request's user may destroy a run."""
    return _may(request, DELETE_PERMISSION)


def upload_login_required(view):
    """Refuse an upload from an anonymous caller. Uploading takes an account, not a permission."""

    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        if not signed_in(request):
            return JsonResponse({"error": "Sign in to upload a model run."}, status=401)
        return view(request, *args, **kwargs)

    return wrapped


def write_login_required(view):
    """Refuse a mutating request from an anonymous caller (401) or unauthorized one (403)."""

    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        if not signed_in(request):
            return JsonResponse(
                {"error": "Sign in to change model runs."},
                status=401,
            )
        if not may_manage_runs(request):
            return JsonResponse(
                {"error": "You do not have permission to delete model runs."},
                status=403,
            )
        return view(request, *args, **kwargs)

    return wrapped


from .app import App, DELETE_PERMISSION

import pyproj

pyproj.network.set_network_enabled(False)


def json_errors(view):
    """Answer 404 for an unregistered run and 503 for unreachable storage, instead of a 500."""

    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        model_run_id = request.GET.get("model_run_id")

        try:
            if model_run_id and not model_run_exists(model_run_id):
                logger.info("Request for unregistered model run: %s", model_run_id)
                return JsonResponse({"error": "No such model run."}, status=404)
            return view(request, *args, **kwargs)
        except UnknownModelRun:
            logger.info("Model run went missing mid-request: %s", model_run_id)
            return JsonResponse({"error": "No such model run."}, status=404)
        except run_store.StorageUnreachable:
            logger.warning("Storage unreachable serving %s", model_run_id, exc_info=True)
            return JsonResponse(
                {"error": "Storage for this run is not reachable right now. "
                          "This is usually momentary -- try again."},
                status=503,
            )

    return wrapped


@controller
@ensure_csrf_cookie
def home(request):
    """Render the map page with the runtime config and permission flags it needs."""
    user = getattr(request, "user", None)
    is_signed_in = signed_in(request)
    context = {
        "app_root_url": reverse(f"{App.package}:{App.index}"),
        "signed_in": is_signed_in,
        "can_delete": may_manage_runs(request),
        "max_upload_bytes": MAX_UPLOAD_BYTES,
        "username": user.get_username() if is_signed_in else "",
        "login_url": settings.LOGIN_URL,
        "logout_url": logout_url(),
    }
    return App.render(request, "index.html", context)


    


@controller
def getModelRuns(request):
    model_run_select = get_model_runs_selectable()
    return JsonResponse({"model_runs": model_run_select})


@controller
@require_POST
@write_login_required
def removeModelRun(request):
    """Delete a run and everything under it. Irreversible."""
    name = (request.POST.get("model_run_id") or "").strip()
    if not name:
        return JsonResponse({"error": "model_run_id is required."}, status=400)

    try:
        run_store.delete(name)
    except LookupError:
        return JsonResponse({"error": "No such model run."}, status=404)
    except OSError:
        logger.exception("Could not delete run %s", name)
        return JsonResponse({"error": "Could not delete that run."}, status=500)

    return JsonResponse({"removed": name})


@controller
@require_POST
@upload_login_required
def createUpload(request):
    """Reserve a job and say how the archive should be sent, after validating the name."""
    name = (request.POST.get("name") or "").strip()
    if not name:
        return JsonResponse({"error": "A name for the run is required."}, status=400)
    if not ingest.is_valid_name(name):
        return JsonResponse(
            {"error": "Use letters, numbers, dots, dashes and underscores in the run name."},
            status=400,
        )
    if run_store.find(name) is not None:
        return JsonResponse(
            {"error": f"A run called {name} already exists."}, status=409
        )

    oversized = _too_large_to_send(request.POST.get("size"))
    if oversized:
        return JsonResponse({"error": oversized}, status=413)

    job_id = uuid.uuid4().hex
    ingest.write_status(job_id, state=ingest.PENDING, stage="waiting",
                        message="waiting for the archive", run=name)

    if not duckdb_conn.is_object_storage():
        return JsonResponse({"job": job_id, "mode": "direct", "name": name})

    try:
        url = _presigned_put(ingest.staging_key(job_id))
    except Exception:  # noqa: BLE001 - reported, not raised into a 500
        logger.exception("Could not presign an upload")
        ingest.write_status(job_id, state=ingest.FAILED, stage="failed",
                            message="This portal's object storage would not accept an upload.",
                            run=name)
        return JsonResponse(
            {"error": "This portal's object storage would not accept an upload."},
            status=503,
        )
    return JsonResponse({"job": job_id, "mode": "presigned", "url": url, "name": name})


def _too_large_to_send(declared):
    """Refuse a size the single PUT cannot carry, before a job is reserved for it.

    The browser checks this too, and reaches the user faster. This is here so a caller that
    did not check gets an answer about the file rather than whatever the store says about a
    request body it will not take.
    """
    try:
        size = int(declared)
    except (TypeError, ValueError):
        return None
    if size <= MAX_UPLOAD_BYTES:
        return None
    return (
        f"That archive is {size / 1024 ** 3:.1f} GiB, over the "
        f"{MAX_UPLOAD_BYTES / 1024 ** 3:.1f} GiB limit for a single upload. Compress the "
        "run as .tar.gz and upload that."
    )


def _presigned_put(key):
    """A URL the browser can PUT the archive to, valid for long enough to send it."""
    backend = run_store.storage()
    bucket = getattr(backend, "bucket_name", None)
    if not bucket:
        raise ingest.IngestError("No bucket is configured for run storage.")

    full_key = run_store.raw_key(backend, key)

    import boto3
    from botocore.config import Config

    client = backend.connection.meta.client
    config = client.meta.config.merge(Config(signature_version="s3v4"))

    public = os.environ.get("NGIAB_S3_PUBLIC_ENDPOINT", "").strip()
    presign_client = boto3.client(
        "s3",
        endpoint_url=public or client.meta.endpoint_url,
        aws_access_key_id=getattr(backend, "access_key", None),
        aws_secret_access_key=getattr(backend, "secret_key", None),
        aws_session_token=getattr(backend, "security_token", None),
        region_name=getattr(backend, "region_name", None),
        config=config,
    )

    return presign_client.generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": full_key},
        ExpiresIn=UPLOAD_URL_TTL_SECONDS,
    )


@controller
@require_POST
@upload_login_required
def startUpload(request):
    """Begin preparing an archive that is already in storage."""
    job_id = (request.POST.get("job") or "").strip()
    name = (request.POST.get("name") or "").strip()
    if not job_id or not name:
        return JsonResponse({"error": "job and name are required."}, status=400)
    if not _is_job_id(job_id) or not ingest.is_valid_name(name):
        return JsonResponse({"error": "That job or name is not valid."}, status=400)

    ingest.write_status(job_id, state=ingest.PENDING, stage="queued",
                        message="preparing to unpack", run=name)
    return _start_or_report(job_id, name, ["--job", job_id, "--name", name])


@controller
@require_POST
@upload_login_required
def uploadRun(request):
    """Take the archive as a plain upload, for deployments with no bucket."""
    job_id = (request.POST.get("job") or "").strip()
    name = (request.POST.get("name") or "").strip()
    upload = request.FILES.get("archive")
    if not upload:
        return JsonResponse({"error": "No archive was uploaded."}, status=400)
    if not _is_job_id(job_id) or not ingest.is_valid_name(name):
        return JsonResponse({"error": "That job or name is not valid."}, status=400)

    handle, path = tempfile.mkstemp(prefix=f"ngiab-{job_id}-", suffix=".archive")
    with os.fdopen(handle, "wb") as sink:
        for chunk in upload.chunks():
            sink.write(chunk)

    ingest.write_status(job_id, state=ingest.PENDING, stage="queued",
                        message="preparing to unpack", run=name)
    return _start_or_report(
        job_id, name, ["--archive", path, "--name", name, "--job", job_id],
        local_archive=path,
    )


@controller
def uploadStatus(request):
    """Where a job has got to. Polled until it reports a terminal state."""
    job_id = (request.GET.get("job") or "").strip()
    if not _is_job_id(job_id):
        return JsonResponse({"error": "That job id is not valid."}, status=400)

    # Reaping is where a dead child's output gets read back and logged, and the only other
    # place it happens is the next _launch -- which on a quiet portal is hours away or never.
    # Polling is the one thing that reliably runs while a job is in flight, so it reaps too.
    _reap()

    try:
        status = ingest.read_status(job_id)
    except run_store.StorageUnreachable:
        logger.warning("Could not read status for job %s", job_id, exc_info=True)
        return JsonResponse(
            {"error": "Could not reach storage to check on this upload. Retrying.",
             "state": ingest.RUNNING, "terminal": False, "job": job_id},
            status=503,
        )

    if status is None:
        return JsonResponse({"error": "No such upload job."}, status=404)
    status["terminal"] = status.get("state") in ingest.TERMINAL
    return JsonResponse(status)


def _is_job_id(value):
    """Job ids are hex uuids we minted; anything else is not one."""
    return bool(value) and len(value) == 32 and all(c in "0123456789abcdef" for c in value)


MAX_CONCURRENT_INGESTS = int(os.environ.get("NGIAB_MAX_CONCURRENT_INGESTS", "2"))

_running = []
_running_lock = threading.Lock()


class IngestBusy(RuntimeError):
    """Too many ingests are already running to start another."""


def _reap():
    """Drop finished children and return how many are still running."""
    with _running_lock:
        return _reap_locked()


DIAGNOSTIC_TAIL_BYTES = 4000

CAPTURE_PREFIX = "ngiab-ingest-log-"

CAPTURE_ORPHAN_SECONDS = 24 * 60 * 60


def _report_child_output(child):
    """Log what a finished ingest wrote, then drop the capture file.

    The child is detached, so its traceback has nowhere to go unless something reads it back.
    A non-zero exit is logged at error; a clean exit that still said something is logged at
    debug, because a warning from a run that worked is not an incident.
    """
    path = getattr(child, "_ngiab_output_log", None)
    if not path:
        return
    try:
        with open(path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - DIAGNOSTIC_TAIL_BYTES))
            captured = handle.read().decode("utf-8", "replace").strip()
        unreadable = None
    except OSError as exc:
        captured, unreadable = "", exc
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass

    if child.returncode and unreadable is not None:
        logger.error(
            "ingest_archive exited %s and its output could not be read: %s",
            child.returncode, unreadable,
        )
    elif child.returncode:
        logger.error(
            "ingest_archive exited %s%s", child.returncode,
            f"; it said:\n{captured}" if captured else " and wrote nothing",
        )
    elif captured:
        logger.debug("ingest_archive finished cleanly and wrote:\n%s", captured)


def _reap_locked():
    """The reaping itself, for callers that already hold the lock."""
    for child in list(_running):
        child.poll()
    finished = [child for child in _running if child.returncode is not None]
    _running[:] = [child for child in _running if child.returncode is None]
    for child in finished:
        _report_child_output(child)
    return len(_running)


def _sweep_abandoned_captures():
    """Remove captures whose worker died before it could read them back.

    _running is per-process, so a worker recycled between launch and exit leaves its
    children's capture files with nobody to unlink them. Best effort by design: a sweep that
    cannot run must never stop an upload from starting.
    """
    cutoff = time.time() - CAPTURE_ORPHAN_SECONDS
    for path in glob.glob(os.path.join(tempfile.gettempdir(), f"{CAPTURE_PREFIX}*.log")):
        try:
            if os.path.getmtime(path) < cutoff:
                os.unlink(path)
        except OSError:
            pass


def _watch(child):
    """Wait for one child and report it, so reporting does not wait for the next upload."""
    try:
        child.wait()
    except Exception:  # noqa: BLE001 - a watcher must never raise into the interpreter
        logger.exception("Could not wait on an ingest child")
        return
    with _running_lock:
        if child in _running:
            _running.remove(child)
    _report_child_output(child)


def _launch(arguments):
    """Run ingest_archive in its own detached process, raising IngestBusy over queueing.

    Its output is captured to a file rather than discarded: the child writes its traceback to
    stderr, and with that on /dev/null a failed ingest left the operator nothing at all --
    the job status carries a fixed sentence by design, so it cannot carry the reason either.

    A file rather than a pipe, deliberately: a pipe would couple the child's lifetime to this
    worker, so recycling the worker mid-publish would kill the ingest with EPIPE. The cost is
    a file on disk, which the watcher below removes as soon as the child exits and
    _sweep_abandoned_captures clears if this worker never gets that far.
    """
    executable = os.path.join(os.path.dirname(sys.executable), "django-admin")
    command = [executable, "ingest_archive", *arguments]
    environment = dict(
        os.environ,
        DJANGO_SETTINGS_MODULE=os.environ.get(
            "DJANGO_SETTINGS_MODULE", "tethys_portal.settings"
        ),
    )
    logger.info("launching %s", " ".join(command))
    _sweep_abandoned_captures()
    with _running_lock:
        if _reap_locked() >= MAX_CONCURRENT_INGESTS:
            raise IngestBusy(
                f"{MAX_CONCURRENT_INGESTS} uploads are already being prepared. "
                "Wait for one to finish and try again."
            )
        capture = tempfile.NamedTemporaryFile(  # noqa: SIM115 - handed to the child
            prefix=CAPTURE_PREFIX, suffix=".log", delete=False
        )
        try:
            child = subprocess.Popen(  # noqa: S603 - fixed executable, validated arguments
                command,
                env=environment,
                stdout=capture,
                stderr=capture,
                start_new_session=True,
            )
        except BaseException:
            capture.close()
            try:
                os.unlink(capture.name)
            except OSError:
                logger.warning("Could not remove the unused capture %s", capture.name)
            raise
        finally:
            capture.close()
        child._ngiab_output_log = capture.name
        _running.append(child)

    # Outside the lock: the watcher takes it itself when the child exits.
    threading.Thread(target=_watch, args=(child,), daemon=True).start()


def _start_or_report(job_id, name, arguments, local_archive=None):
    """Launch an ingest, turning a failure to launch into a job the client can see."""
    def abandon(message, status):
        ingest.write_status(job_id, state=ingest.FAILED, stage="failed",
                            message=message, run=name)
        ingest.discard_staged(job_id)
        _discard_local(local_archive)
        return JsonResponse({"error": message}, status=status)

    try:
        _launch(arguments)
    except IngestBusy as exc:
        return abandon(str(exc), 503)
    except Exception:  # noqa: BLE001 - any launch failure must become a visible job
        logger.exception("Could not launch the ingest for job %s", job_id)
        return abandon("The server could not start preparing this upload.", 500)
    return JsonResponse({"job": job_id, "state": ingest.PENDING})


def _discard_local(path):
    """Remove a temp archive this process wrote, if there is one."""
    if not path:
        return
    try:
        os.remove(path)
    except OSError:
        logger.warning("Could not remove the temporary archive %s", path, exc_info=True)


@controller
@json_errors
def getCatchmentTimeSeries(request):
    model_run_id = request.GET.get("model_run_id")
    catchment_id = request.GET.get("catchment_id")
    if not catchment_id:
        return JsonResponse({"error": "catchment_id is required."}, status=400)

    variable_column = request.GET.get("variable_column")
    outputs = run_outputs(model_run_id)

    try:
        all_columns = _read_output_columns(outputs, catchment_id)
    except FileNotFoundError:
        return JsonResponse(
            {"error": f"This run has no output for {catchment_id}."}, status=404
        )

    time_name = all_columns[1]
    list_variables = all_columns[2:]

    selected = variable_column if variable_column in list_variables else list_variables[0]

    df = _read_output_frame(
        outputs, catchment_id, columns=[time_name, selected], time_column=time_name
    )

    try:
        max_points = int(request.GET.get("max_points", _DEFAULT_MAX_POINTS))
    except (TypeError, ValueError):
        max_points = _DEFAULT_MAX_POINTS

    series = build_series_payload(
        to_epoch_seconds(df[time_name].tolist()),
        df[selected].tolist(),
        max_points=max_points,
    )
    series["label"] = f"{catchment_id}-{selected}"

    return JsonResponse(
        {
            "data": [series],
            "variables": [
                {"value": variable, "label": variable.lower().replace("_", " ")}
                for variable in list_variables
            ],
            "variable": selected,
            "layout": {
                "yaxis": selected,
                "xaxis": "",
                "title": "",
            },
            "catchment_ids": getCatchmentsIds(model_run_id),
        }
    )


@controller
@json_errors
def getCatchmentVariables(request):
    """Variables available to shade the map, for this run only."""
    model_run_id = request.GET.get("model_run_id")
    if not model_run_id:
        return JsonResponse({"error": "model_run_id is required"})
    return JsonResponse(get_catchment_variables(model_run_id))


@controller
@json_errors
def getCatchmentValueMatrix(request):
    """Quantised per-catchment values over time, for the choropleth and timeline."""
    model_run_id = request.GET.get("model_run_id")
    if not model_run_id:
        return JsonResponse({"error": "model_run_id is required"})

    try:
        return JsonResponse(get_catchment_value_matrix(model_run_id, request.GET.get("variable")))
    except (OSError, ValueError, duckdb.Error):
        logger.exception("Could not build the value matrix for %s", model_run_id)
        return JsonResponse({"error": "Could not read this run's outputs."})


@controller
@json_errors
def getGeoSpatialData(request):
    """The catchment ids in this run, and the extent to frame the map on."""
    model_run_id = request.GET.get("model_run_id")
    bounds = run_bounds_4326(model_run_id)
    if bounds is None:
        return JsonResponse({"error": "Failed to read GeoPackage file."})

    return JsonResponse(
        {"catchments": getCatchmentsList(model_run_id), "bounds": bounds}
    )


def _troute_note(flowpath_id, divide_id, feature_id, variable):
    """One line telling the reader that this chart is a channel, not the catchment polygon."""
    if flowpath_id and divide_id:
        sentence = f"Channel routing along flowpath {flowpath_id}, which drains {divide_id}."
    elif flowpath_id:
        sentence = f"Channel routing along flowpath {flowpath_id}."
    else:
        sentence = f"Channel routing at T-Route feature {feature_id}."

    caveat = troute_variable_note(variable)
    return f"{sentence} {caveat}" if caveat else sentence


@controller
@json_errors
def getTrouteVariables(request):
    model_run_id = request.GET.get("model_run_id")
    feature_id = parse_troute_feature_id(request.GET.get("troute_id"))
    df = get_troute_df(model_run_id)

    if df is None or feature_id is None:
        return JsonResponse({"troute_variables": []})

    try:
        present = check_troute_id(df, feature_id)
    except (KeyError, ValueError, TypeError):
        present = False

    return JsonResponse({"troute_variables": get_troute_vars(df) if present else []})


@controller
@json_errors
def getTrouteTimeSeries(request):
    model_run_id = request.GET.get("model_run_id")
    troute_id = request.GET.get("troute_id")

    clean_troute_id = parse_troute_feature_id(troute_id)
    if clean_troute_id is None:
        return JsonResponse({"error": f"Not a usable troute id: {troute_id!r}"})

    df = get_troute_df(model_run_id)

    available = [variable["value"] for variable in get_troute_vars(df)]
    requested = request.GET.get("troute_variable")
    variable_column = requested if requested in available else (available[0] if available else None)
    if variable_column is None:
        return JsonResponse({"error": "This model run has no plottable troute variables."})

    try:
        selected = df[df[TROUTE_FEATURE_COLUMN] == clean_troute_id]
        data = [
            {"x": str(when), "y": None if value == TROUTE_MISSING else value}
            for when, value in zip(
                selected[TROUTE_TIME_COLUMN].tolist(), selected[variable_column].tolist()
            )
        ]
    except (KeyError, TypeError) as exc:
        logger.warning("Could not slice troute output for %s: %s", clean_troute_id, exc)
        data = []

    flowpath_id, divide_id = describe_troute_feature(model_run_id, clean_troute_id)
    series_label = f"{flowpath_id or troute_id} {variable_column}"

    troute_variables = get_troute_vars(df)
    axis_label = next(
        (v["label"] for v in troute_variables if v["value"] == variable_column),
        variable_column,
    )

    return JsonResponse(
        {
            "data": [
                {
                    "label": series_label,
                    "data": data,
                }
            ],
            "variable": variable_column,
            "troute_variables": troute_variables,
            "note": _troute_note(flowpath_id, divide_id, clean_troute_id, variable_column),
            "layout": {
                "yaxis": axis_label,
                "xaxis": "",
                "title": "",
            },
        }
    )


def _empty_ts_response(variable, status_message, status_severity, variables=None):
    return JsonResponse(
        {
            "metrics": [],
            "data": [],
            "teehr_variables": variables or [],
            "variable": variable,
            "layout": {
                "yaxis": (variable or "").title(),
                "xaxis": "",
                "title": "",
            },
            "teehr_status": status_message,
            "teehr_status_severity": status_severity,
        }
    )


def _teehr_variables_for(model_run_id):
    """The '<config>-<variable>' options for this run, or [] if none are readable."""
    open_reader, config_name = teehr_source(model_run_id)
    if open_reader is None:
        return []
    with open_reader() as reader:
        return reader.list_configurations_for_run(config_name) or []


@controller
@json_errors
def getTeehrTimeSeries(request):
    """Observed and simulated series for one gauge, plus its metrics."""
    teehr_id = request.GET.get("teehr_id")
    model_run_id = request.GET.get("model_run_id")

    open_reader, _ = teehr_source(model_run_id)
    if open_reader is None:
        return _empty_ts_response(None, "No TEEHR evaluation found for this run.", "info")

    available = _teehr_variables_for(model_run_id)
    options = [entry["value"] for entry in available]
    requested = request.GET.get("teehr_variable")
    selected = requested if requested in options else (options[0] if options else None)

    if selected is None:
        return _empty_ts_response(
            None, "No TEEHR evaluation found for this run.", "info", available
        )

    teehr_configuration, _, teehr_variable = selected.partition("-")
    if not teehr_configuration or not teehr_variable:
        return _empty_ts_response(
            selected, "That TEEHR configuration is not readable.", "warning", available
        )
    with open_reader() as reader:
        data = reader.get_joined_timeseries(
            teehr_configuration, teehr_variable, teehr_id
        )
        metrics = reader.get_metrics_for_location(teehr_configuration, teehr_id)

    if not data:
        return _empty_ts_response(
            selected,
            "No TEEHR data for this location.",
            "info",
            available,
        )
    return JsonResponse(
        {
            "metrics": metrics,
            "data": data,
            "teehr_variables": available,
            "variable": selected,
            "layout": {"yaxis": teehr_variable.title(), "xaxis": "", "title": ""},
            "teehr_status": None,
            "teehr_status_severity": None,
        }
    )


def _empty_variables_response(status_message, status_severity):
    return JsonResponse(
        {
            "teehr_variables": [],
            "teehr_status": status_message,
            "teehr_status_severity": status_severity,
        }
    )


@controller
@json_errors
def getTeehrVariables(request):
    model_run_id = request.GET.get("model_run_id")

    open_reader, config_name = teehr_source(model_run_id)
    if open_reader is None:
        return _empty_variables_response(
            "No TEEHR evaluation found for this run.",
            "info",
        )

    with open_reader() as reader:
        variables = reader.list_configurations_for_run(config_name)

    if not variables:
        return _empty_variables_response(
            "No TEEHR evaluation found for this run.",
            "info",
        )
    return JsonResponse(
        {
            "teehr_variables": variables,
            "teehr_status": None,
            "teehr_status_severity": None,
        }
    )


def _empty_locations_response(status_message, status_severity):
    return JsonResponse(
        {
            "teehr_locations": [],
            "teehr_status": status_message,
            "teehr_status_severity": status_severity,
        }
    )


@controller
@json_errors
def getTeehrLocations(request):
    """Return the nexus/USGS pairs that actually have TEEHR results for this run."""
    model_run_id = request.GET.get("model_run_id")

    open_reader, config_name = teehr_source(model_run_id)
    if open_reader is None:
        return _empty_locations_response(
            "No TEEHR evaluation found for this run.",
            "info",
        )

    with open_reader() as reader:
        pairs = reader.list_location_pairs_for_run(config_name)

    locations = [
        {"nexus_id": ngen_id.replace("ngen-", "nex-", 1), "usgs_id": usgs_id}
        for usgs_id, ngen_id in pairs
    ]

    if not locations:
        return _empty_locations_response(
            "No TEEHR results for this run's locations.",
            "info",
        )

    return JsonResponse(
        {
            "teehr_locations": locations,
            "teehr_status": None,
            "teehr_status_severity": None,
        }
    )


