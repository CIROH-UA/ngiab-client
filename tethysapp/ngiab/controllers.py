from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_POST
from django.urls import reverse
import functools
import logging
import os
import posixpath
import subprocess
import sys
import tempfile
import threading
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
from .teehr_warehouse import (
    TeehrWarehouseError,
    UnsupportedWarehouseVersion,
    WarehouseCatalogLocked,
    WarehouseMountMirrorBroken,
    WarehouseUnreachable,
)

logger = logging.getLogger(__name__)


#: Granted through the ``run_managers`` group; see App.permissions.
DELETE_PERMISSION = "delete_model_runs"
UPLOAD_PERMISSION = "upload_model_runs"

#: How long a presigned upload URL stays valid. Six hours, because the ceiling on what
#: can be uploaded is the user's link rather than anything this app controls.
UPLOAD_URL_TTL_SECONDS = 6 * 60 * 60


def _may(request, permission):
    """Whether this request's user holds one app permission.

    Superusers short-circuit rather than relying on ``has_permission``. Django grants a
    superuser every permission anyway, but only once Tethys has resolved the request to an
    installed app -- and that resolution reads the URL. Answering from the user object keeps
    an administrator working regardless.

    Fails closed. The actions behind these permissions destroy data or consume shared
    storage, so a lookup that breaks should stop them rather than wave them through.
    """
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated:
        return False
    if getattr(user, "is_superuser", False):
        return True
    try:
        return bool(has_permission(request, permission))
    except Exception:  # noqa: BLE001 - see the docstring: any failure denies
        logger.exception("Could not evaluate the %s permission", permission)
        return False


def may_upload_runs(request):
    """Whether this request's user may add a run."""
    return _may(request, UPLOAD_PERMISSION)


def may_manage_runs(request):
    """Whether this request's user may destroy a run."""
    return _may(request, DELETE_PERMISSION)


def upload_permission_required(view):
    """Refuse an upload from anyone without the upload permission.

    Separate from delete so the two can be granted apart: adding a run is additive, removing
    one is not, and the destructive grant should stay the scarcer of the two.
    """

    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        if not getattr(request, "user", None) or not request.user.is_authenticated:
            return JsonResponse({"error": "Sign in to upload a model run."}, status=401)
        if not may_upload_runs(request):
            return JsonResponse(
                {"error": "You do not have permission to upload model runs."}, status=403
            )
        return view(request, *args, **kwargs)

    return wrapped


def write_login_required(view):
    """Refuse a mutating request from an anonymous caller.

    Django's own authentication, deliberately, not Tethys's. ``@controller(login_required=True)``
    is inert here: ``tethys_apps/decorators.py`` checks ``ENABLE_OPEN_PORTAL`` at call time and
    passes straight through when it is set, which it is. Verified both ways -- Tethys's decorator
    answers 200 for an anonymous request under an open portal, Django's answers 302.

    401 rather than 403, and rather than Django's redirect. The caller is not forbidden, it is
    unauthenticated, and ``api/client.js`` already turns a 401 into a redirect to the login page
    with ``?next=``, which is the behaviour wanted. A 302 would be worse than useless here: fetch
    follows redirects, so the browser would receive the login page's HTML with a 200 and the
    client would report unreadable JSON.

    Reads stay open. This wraps only the endpoints that change something.

    Two refusals, not one, because the client acts on them differently. An anonymous caller
    gets 401 and ``api/client.js`` sends them to sign in. A signed-in caller without the
    permission gets 403, which the same client renders as a message and does *not* redirect
    -- sending them to a login page they are already past would be a loop.
    """

    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        if not getattr(request, "user", None) or not request.user.is_authenticated:
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


# Map warehouse exception → user-facing (status_message, severity) string pair.
# See plan FR6 for the full state table.
def _teehr_status_for(exc: TeehrWarehouseError):
    if isinstance(exc, UnsupportedWarehouseVersion):
        return (
            "TEEHR warehouse was written by an unsupported TEEHR version.",
            "warning",
        )
    if isinstance(exc, WarehouseCatalogLocked):
        return (
            "TEEHR warehouse is busy or improperly closed. Wait and refresh, or rerun TEEHR.",
            "warning",
        )
    if isinstance(exc, WarehouseMountMirrorBroken):
        return (
            "TEEHR warehouse files are not reachable. Check the mount configuration.",
            "error",
        )
    if isinstance(exc, WarehouseUnreachable):
        return ("TEEHR warehouse appears empty. Run TEEHR to populate it.", "info")
    # Generic fallback
    return ("TEEHR warehouse could not be read.", "error")

from .app import App

# the following error is fixed with this lines
# https://stackoverflow.com/a/79163867
import pyproj

pyproj.network.set_network_enabled(False)


def json_errors(view):
    """Answer for a run that is not registered, rather than letting a path build from None.

    A shared link outlives the run it names, and every data endpoint would otherwise raise
    inside os.path.join and return a 500 the client can only describe as 'try again'.

    Storage being unreachable answers 503 for the same reason it is now raised rather than
    swallowed: the honest answer to "the bucket refused us" is to say so and invite a retry,
    where the old empty result said "this run has no data" and the alternative -- letting it
    out as a 500 -- says "this is broken, do not try again". 503 is in the client's retryable
    set, so a momentary failure recovers instead of becoming a dead-looking map.
    """

    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        model_run_id = request.GET.get("model_run_id")

        try:
            # Up front, so the warehouse-backed TEEHR endpoints answer like the rest.
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
    """Render the map page.

    index.html loads the build-less vanilla frontend from public/frontend/ and injects the
    runtime config into window.__NGIAB__, which replaces the React build's compile-time
    TETHYS_APP_ROOT_URL substitution.

    ensure_csrf_cookie because the page renders no Django form: without it the token is
    never handed out, document.cookie has no csrftoken, and every POST is rejected.

    The two permission flags decide whether the page renders a delete control at all. They
    are a courtesy, not a control: removeModelRun re-checks on every call, because anything
    decided in a template can be edited in a console.
    """
    # reverse(), not "/apps/<root>/": MULTIPLE_APP_MODE false mounts the app at "/".
    user = getattr(request, "user", None)
    context = {
        "app_root_url": reverse(f"{App.package}:{App.index}"),
        "signed_in": bool(user and user.is_authenticated),
        "can_delete": may_manage_runs(request),
        "can_upload": may_upload_runs(request),
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
    """Delete a run and everything under it. Irreversible.

    The run picker is derived from the storage root now, so removal has to delete: a removal
    that only forgot would put the run back on the next listing. That resurrection is not
    hypothetical -- under the old JSON registry, deleting the sole run brought it back on the
    next request, which made unregistering look broken.

    So this reverses a deliberate earlier decision that the app should contain no delete at
    all. Two things carry the weight instead: it is unreachable without signing in, and the
    interface names what is about to be destroyed before calling it.

    Takes a run name, never a path. An unknown name is a 404 rather than a 400, because the
    caller is naming something that is not there.
    """
    name = (request.POST.get("model_run_id") or "").strip()
    if not name:
        return JsonResponse({"error": "model_run_id is required."}, status=400)

    try:
        run_store.delete(name)
    except LookupError:
        return JsonResponse({"error": "No such model run."}, status=404)
    except OSError as exc:
        logger.exception("Could not delete run %s", name)
        return JsonResponse(
            {"error": f"Could not delete that run: {exc.strerror or exc}"}, status=500
        )

    return JsonResponse({"removed": name})


@controller
@require_POST
@upload_permission_required
def createUpload(request):
    """Reserve a job and say how the archive should be sent.

    Hosted, the answer is a presigned PUT straight into the bucket: the archive is the
    largest thing this app handles, and routing gigabytes through one uvicorn worker would
    stall the portal for every other user while it copied. Locally there is no bucket, so
    the client posts the file here instead.

    The name is validated now rather than after the transfer, because being told the name is
    taken is worth much less once the user has already waited out a 6 GB upload.
    """
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

    job_id = uuid.uuid4().hex
    ingest.write_status(job_id, state=ingest.PENDING, stage="waiting",
                        message="waiting for the archive", run=name)

    if not duckdb_conn.is_object_storage():
        return JsonResponse({"job": job_id, "mode": "direct", "name": name})

    try:
        url = _presigned_put(ingest.staging_key(job_id))
    except Exception as exc:  # noqa: BLE001 - reported, not raised into a 500
        logger.exception("Could not presign an upload")
        ingest.write_status(job_id, state=ingest.FAILED, stage="failed",
                            message=str(exc), run=name)
        return JsonResponse(
            {"error": "This portal's object storage would not accept an upload."},
            status=503,
        )
    return JsonResponse({"job": job_id, "mode": "presigned", "url": url, "name": name})


def _presigned_put(key):
    """A URL the browser can PUT the archive to, valid for long enough to send it.

    NGIAB_S3_PUBLIC_ENDPOINT exists because the endpoint the server uses is not always the
    one a browser can resolve -- a container talking to ``minio:9000`` presigns a host that
    means nothing outside the container network, and the same split shows up wherever the
    bucket has an internal service address. Signing is host-sensitive, so the substitution
    happens before the signature rather than after.
    """
    backend = run_store.storage()
    bucket = getattr(backend, "bucket_name", None)
    if not bucket:
        raise ingest.IngestError("No bucket is configured for run storage.")

    prefix = (getattr(backend, "location", "") or "").strip("/")
    full_key = posixpath.join(prefix, key) if prefix else key

    public = os.environ.get("NGIAB_S3_PUBLIC_ENDPOINT", "").strip()
    client = backend.connection.meta.client
    if public:
        import boto3

        client = boto3.client(
            "s3",
            endpoint_url=public,
            aws_access_key_id=getattr(backend, "access_key", None),
            aws_secret_access_key=getattr(backend, "secret_key", None),
            region_name=getattr(backend, "region_name", None),
            config=client.meta.config,
        )

    return client.generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": full_key},
        ExpiresIn=UPLOAD_URL_TTL_SECONDS,
    )


@controller
@require_POST
@upload_permission_required
def startUpload(request):
    """Begin preparing an archive that is already in storage.

    Returns as soon as the job is launched. Extraction and conversion happen in another
    process -- see the ingest_archive command for why a thread would not do.
    """
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
@upload_permission_required
def uploadRun(request):
    """Take the archive as a plain upload, for deployments with no bucket.

    Written to a temporary file rather than held in memory: Django spills large uploads to
    disk already, and the job needs a path it can hand to another process anyway.
    """
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
    """Where a job has got to. Polled until it reports a terminal state.

    A storage failure answers 503 with ``terminal: false`` rather than 500. Letting it out
    as a server error made the client report a job that was very likely still running as one
    that had failed, because any error ends its poll loop.
    """
    job_id = (request.GET.get("job") or "").strip()
    if not _is_job_id(job_id):
        return JsonResponse({"error": "That job id is not valid."}, status=400)

    try:
        status = ingest.read_status(job_id)
    except run_store.StorageUnreachable:
        # Explicitly not terminal: the client stops polling on a terminal answer.
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
    """Job ids are hex uuids we minted; anything else is not one.

    Checked because the id reaches a storage key and a subprocess argument.
    """
    return bool(value) and len(value) == 32 and all(c in "0123456789abcdef" for c in value)


#: Ingests allowed to run at once. Each holds the GIL through DuckDB and pandas for the
#: length of a conversion, and the image serves on one uvicorn worker by default, so an
#: unbounded fan-out starves the portal and can exhaust memory. Per worker process, which is
#: the same granularity the rest of this module's process-local state already has.
MAX_CONCURRENT_INGESTS = int(os.environ.get("NGIAB_MAX_CONCURRENT_INGESTS", "2"))

#: Handles for launched ingests, kept only so they can be reaped. Nothing waits on these.
#:
#: Guarded by a lock because the check and the append are not one step: two requests arriving
#: together -- the case the bound exists to police -- could both read a count under the limit
#: before either appended, and one thread's rebuild of the list could drop the other's handle,
#: leaving a child untracked, never reaped, and never counted against the bound.
_running = []
_running_lock = threading.Lock()


class IngestBusy(RuntimeError):
    """Too many ingests are already running to start another."""


def _reap():
    """Drop finished children and return how many are still running.

    Popen objects that are never waited on leave zombies until the worker exits. Nothing
    here needs the exit status -- the job's own status object carries the outcome -- but
    something has to call poll() or the process table fills with one entry per upload.
    """
    with _running_lock:
        return _reap_locked()


def _reap_locked():
    """The reaping itself, for callers that already hold the lock.

    ``_launch`` is one: its count and its append have to be one step, so it cannot reap
    through ``_reap`` and then take the lock again.

    Mutates in place rather than rebinding, so a concurrent append cannot be overwritten by
    a list this call built from an earlier read.
    """
    for child in list(_running):
        child.poll()
    _running[:] = [child for child in _running if child.returncode is None]
    return len(_running)


def _launch(arguments):
    """Run ingest_archive in its own process.

    django-admin rather than a located manage.py: the settings module is the same one this
    process is running under, and resolving manage.py costs a subprocess of its own. The
    child is deliberately not waited on -- it outlives this request by design, and its exit
    status reaches the client through the job status rather than through the return code.

    Raises IngestBusy rather than queueing. A queue would need to survive a restart to be
    worth anything, and the honest answer to "the machine is already converting two runs" is
    to say so now rather than accept work that will sit invisibly.
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
    with _running_lock:
        if _reap_locked() >= MAX_CONCURRENT_INGESTS:
            raise IngestBusy(
                f"{MAX_CONCURRENT_INGESTS} uploads are already being prepared. "
                "Wait for one to finish and try again."
            )
        _running.append(
            subprocess.Popen(  # noqa: S603 - fixed executable, validated arguments
                command,
                env=environment,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        )


def _start_or_report(job_id, name, arguments, local_archive=None):
    """Launch an ingest, turning a failure to launch into a job the client can see.

    Without this a Popen that never starts -- a missing django-admin, a fork that fails
    under memory pressure, too many already running -- raised out of the view after the
    status was already written PENDING and, on the presigned path, after the archive was
    already in the bucket. The client polled a job that would never move and the staged
    archive was never discarded.

    ``local_archive`` is the temp file uploadRun wrote before calling here. The ingest child
    removes it once it starts; when the launch is what failed, the child never runs and
    nothing else would. IngestBusy is routine rather than exceptional, so without this every
    refusal left a whole archive on disk.
    """
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

    # The manifest lists what this run wrote, so an id it never wrote is a 404, not a 500.
    try:
        all_columns = _read_output_columns(outputs, catchment_id)
    except FileNotFoundError:
        return JsonResponse(
            {"error": f"This run has no output for {catchment_id}."}, status=404
        )

    time_name = all_columns[1]
    list_variables = all_columns[2:]  # drop time step and time

    selected = variable_column if variable_column in list_variables else list_variables[0]

    df = _read_output_frame(
        outputs, catchment_id, columns=[time_name, selected], time_column=time_name
    )

    # Columnar and thinned; ?max_points=0 asks for the full series. See the frontend README.
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
    except (OSError, ValueError, duckdb.Error) as exc:
        logger.exception("Could not build the value matrix for %s", model_run_id)
        return JsonResponse({"error": f"Could not read this run's outputs: {exc}"})


@controller
@json_errors
def getGeoSpatialData(request):
    """The catchment ids in this run, and the extent to frame the map on.

    Nothing else: the map draws its geometry from the hydrofabric pmtiles, not from this
    response. It used to read the whole nexus layer into a GeoDataFrame, crosswalk every
    feature against the TEEHR warehouse twice, and serialise the result as GeoJSON -- all of
    which the frontend threw away.
    """
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

    # Narrow, so a bug in here stops masquerading as a run without routing output.
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

    # The client omits a null variable on first load, so the server picks one.
    available = [variable["value"] for variable in get_troute_vars(df)]
    requested = request.GET.get("troute_variable")
    variable_column = requested if requested in available else (available[0] if available else None)
    if variable_column is None:
        return JsonResponse({"error": "This model run has no plottable troute variables."})

    # One shape reaches here now; see utils._normalised_troute_frame for what it replaced.
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
            # Always carried, so the picker can populate even when there is nothing to plot.
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
    try:
        with open_reader() as reader:
            return reader.list_configurations_for_run(config_name) or []
    except TeehrWarehouseError as exc:
        logger.warning("Could not list TEEHR variables: %s", exc)
        return []


@controller
@json_errors
def getTeehrTimeSeries(request):
    """Observed and simulated series for one gauge, plus its metrics.

    Takes model_run_id (the registered run), teehr_id (a USGS gauge such as
    "usgs-02464000") and teehr_variable, which is "<configuration>-<variable>", for example
    "ngen_ngiab-streamflow_hourly_inst".
    """
    teehr_id = request.GET.get("teehr_id")
    model_run_id = request.GET.get("model_run_id")

    open_reader, _ = teehr_source(model_run_id)
    if open_reader is None:
        return _empty_ts_response(None, "No TEEHR evaluation found for this run.", "info")

    # The client omits a null variable on first load, so the server picks one.
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
    try:
        with open_reader() as reader:
            data = reader.get_joined_timeseries(
                teehr_configuration, teehr_variable, teehr_id
            )
            metrics = reader.get_metrics_for_location(teehr_configuration, teehr_id)
    except TeehrWarehouseError as exc:
        msg, severity = _teehr_status_for(exc)
        logger.warning("getTeehrTimeSeries warehouse error: %s", exc)
        return _empty_ts_response(selected, msg, severity, available)

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

    try:
        with open_reader() as reader:
            variables = reader.list_configurations_for_run(config_name)
    except TeehrWarehouseError as exc:
        msg, severity = _teehr_status_for(exc)
        logger.warning("getTeehrVariables warehouse error: %s", exc)
        return _empty_variables_response(msg, severity)

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
    """Return the nexus/USGS pairs that actually have TEEHR results for this run.

    Lets the map colour geometry by TEEHR availability, filtered to this run's
    configuration and to gauges that have something to compare against.
    """
    model_run_id = request.GET.get("model_run_id")

    open_reader, config_name = teehr_source(model_run_id)
    if open_reader is None:
        return _empty_locations_response(
            "No TEEHR evaluation found for this run.",
            "info",
        )

    try:
        with open_reader() as reader:
            pairs = reader.list_location_pairs_for_run(config_name)
    except TeehrWarehouseError as exc:
        msg, severity = _teehr_status_for(exc)
        logger.warning("getTeehrLocations warehouse error: %s", exc)
        return _empty_locations_response(msg, severity)

    # secondary_location_id is "ngen-XXXXX"; the gpkg/map nexus ids are "nex-XXXXX".
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


