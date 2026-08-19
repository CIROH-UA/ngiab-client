from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_POST
from django.core.exceptions import ValidationError
from django.urls import reverse
import functools
import logging
import pandas as pd
import duckdb
from tethys_sdk.routing import controller
from .utils import (
    UnknownModelRun,
    model_run_exists,
    scan_importable_runs,
    describe_importable_run,
    teehr_name_from_manifest,
    get_base_output,
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
    getCatchmentsList,
    find_gpkg_file_path,
    gpkg_layer_bounds_4326,
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
    """

    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        model_run_id = request.GET.get("model_run_id")

        # Up front, so the warehouse-backed TEEHR endpoints answer like the rest.
        if model_run_id and not model_run_exists(model_run_id):
            logger.info("Request for unregistered model run: %s", model_run_id)
            return JsonResponse({"error": "No such model run."}, status=404)

        try:
            return view(request, *args, **kwargs)
        except UnknownModelRun:
            logger.info("Model run went missing mid-request: %s", model_run_id)
            return JsonResponse({"error": "No such model run."}, status=404)

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
    """
    # reverse(), not "/apps/<root>/": MULTIPLE_APP_MODE false mounts the app at "/".
    context = {"app_root_url": reverse(f"{App.package}:{App.index}")}
    return App.render(request, "index.html", context)


    


@controller
def getModelRuns(request):
    model_run_select = get_model_runs_selectable()
    return JsonResponse({"model_runs": model_run_select})


@controller
@require_POST
def removeModelRun(request):
    """Unregister a model run.

    Only removes the database row -- the run directory on disk is left alone. Deleting a
    user's model output because they tidied up a list would be a surprising amount of
    destruction for an unregister action.

    POST because it mutates: as a GET a link prefetch or a crawler could unregister a run.
    """
    from .models import ModelRun

    model_run_id = request.POST.get("model_run_id")
    if not model_run_id:
        return JsonResponse({"error": "model_run_id is required."}, status=400)

    try:
        deleted, _ = ModelRun.objects.filter(id=model_run_id).delete()
    except (ValueError, ValidationError):
        # A malformed uuid is a bad request, not a server error.
        return JsonResponse({"error": f"Not a valid model run id: {model_run_id}"}, status=400)

    if not deleted:
        return JsonResponse({"error": "No such model run."}, status=404)

    return JsonResponse({"removed": model_run_id})


@controller
def scanModelRuns(request):
    """List the directories under the managed root that could be registered.

    Offers what is already mounted rather than a path to type: the container can only see
    the mount, and a name the user picks from a list cannot point anywhere else.
    """
    return JsonResponse({"candidates": scan_importable_runs()})


@controller
@require_POST
def registerModelRun(request):
    """Register one directory the scan offered.

    Takes the path the scan reported, and accepts it only if a fresh scan would report it
    again, so the set of registerable directories is exactly the set on offer.
    """
    from .models import ModelRun

    run_path = (request.POST.get("path") or "").strip()

    # Refused unless a fresh scan would offer this exact path; see the docstring.
    described = describe_importable_run(run_path)
    if described is None:
        return JsonResponse({"error": "That is not a directory the visualizer offers."}, status=404)
    if not described["importable"]:
        return JsonResponse({"error": described["reason"]}, status=400)

    # Idempotent on path, like register_run: a second import updates rather than duplicates.
    run, created = ModelRun.objects.update_or_create(
        path=run_path,
        defaults={
            "label": described["label"],
            "teehr_configuration_name": teehr_name_from_manifest(run_path),
        },
    )

    return JsonResponse({"model_run_id": str(run.id), "created": created})


@controller
@json_errors
def getCatchmentTimeSeries(request):
    model_run_id = request.GET.get("model_run_id")
    catchment_id = request.GET.get("catchment_id")
    if not catchment_id:
        return JsonResponse({"error": "catchment_id is required."}, status=400)

    variable_column = request.GET.get("variable_column")
    base_output_path = get_base_output(model_run_id)

    # catchment_id names a file on disk, so an id this run never wrote is a 404, not a 500.
    try:
        all_columns = _read_output_columns(base_output_path, catchment_id)
    except FileNotFoundError:
        return JsonResponse(
            {"error": f"This run has no output for {catchment_id}."}, status=404
        )

    time_name = all_columns[1]
    list_variables = all_columns[2:]  # drop time step and time

    selected = variable_column if variable_column in list_variables else list_variables[0]

    df = _read_output_frame(
        base_output_path, catchment_id, columns=[time_name, selected], time_column=time_name
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

    try:
        gpkg_path = find_gpkg_file_path(model_run_id)
    except UnknownModelRun:
        raise
    except Exception:
        logger.exception("Could not locate a GeoPackage for %s", model_run_id)
        return JsonResponse({"error": "Failed to read GeoPackage file."})

    if not gpkg_path:
        return JsonResponse({"error": "Failed to read GeoPackage file."})

    return JsonResponse(
        {
            "catchments": getCatchmentsList(model_run_id),
            "bounds": gpkg_layer_bounds_4326(gpkg_path),
        }
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

    try:
        if isinstance(df.index, pd.MultiIndex):
            # Multi-indexed DataFrame: Slice using `feature_id` in the multi-index
            df_sliced_by_id = df.xs(clean_troute_id, level="feature_id")
            time_col = df_sliced_by_id.index.get_level_values("time")
        else:
            # Flat-indexed DataFrame: Filter using `featureID` column
            df_sliced_by_id = df[df["featureID"] == clean_troute_id]
            time_col = df_sliced_by_id["current_time"]

        var_col = df_sliced_by_id[variable_column]

        data = [
            {
                "x": (
                    time.strftime("%Y-%m-%d %H:%M:%S")
                    if isinstance(time, pd.Timestamp)
                    else str(time)
                ),
                "y": None if val is None or val == TROUTE_MISSING else val,
            }
            for time, val in zip(time_col.tolist(), var_col.tolist())
        ]
    except Exception as e:
        print(f"Error: {e}")
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


