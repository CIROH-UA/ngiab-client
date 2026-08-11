from django.http import JsonResponse
from django.core.exceptions import ValidationError
from django.urls import reverse
import logging
import pandas as pd
import re
import duckdb
from tethys_sdk.routing import controller
from .utils import (
    get_base_output,
    _read_output_frame,
    _read_output_columns,
    getCatchmentsIds,
    check_troute_id,
    get_troute_vars,
    get_troute_df,
    getCatchmentsList,
    find_gpkg_file_path,
    gpkg_layer_bounds_4326,
    get_model_runs_selectable,
    get_catchment_variables,
    get_catchment_value_matrix,
    _resolve_configuration_name,
    _detect_legacy_teehr_layout,
    _open_warehouse,
    _teehr_warehouse_path,
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


@controller
def home(request):
    """Controller for the app home page."""
    # index.html loads the build-less vanilla frontend from public/frontend/ and injects
    # runtime config into window.__NGIAB__, replacing the React build's compile-time
    # TETHYS_APP_ROOT_URL substitution.
    # reverse(), not a hardcoded "/apps/<root>/": under MULTIPLE_APP_MODE false the app is
    # mounted at "/" instead, and every frontend endpoint is built from this value.
    context = {"app_root_url": reverse(f"{App.package}:{App.index}")}
    return App.render(request, "index.html", context)


    


@controller
def getModelRuns(request):
    model_run_select = get_model_runs_selectable()
    return JsonResponse({"model_runs": model_run_select})


@controller
def removeModelRun(request):
    """Unregister a model run.

    Only removes the database row -- the run directory on disk is left alone. Deleting a
    user's model output because they tidied up a list would be a surprising amount of
    destruction for an unregister action.
    """
    from .models import ModelRun

    model_run_id = request.GET.get("model_run_id")
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
def getCatchmentTimeSeries(request):
    model_run_id = request.GET.get("model_run_id")
    catchment_id = request.GET.get("catchment_id")
    variable_column = request.GET.get("variable_column")
    base_output_path = get_base_output(model_run_id)

    # Prefers parquet, falls back to csv: viewOnTethys.sh converts a run's outputs at
    # import, but runs registered before that still have csv only.
    #
    # The column list comes from metadata, then only the two columns actually plotted are
    # read. On parquet that is the difference between scanning seventeen columns and two.
    all_columns = _read_output_columns(base_output_path, catchment_id)
    time_name = all_columns[1]
    list_variables = all_columns[2:]  # drop time step and time

    selected = variable_column if variable_column in list_variables else list_variables[0]

    df = _read_output_frame(
        base_output_path, catchment_id, columns=[time_name, selected], time_column=time_name
    )
    time_col = df[time_name]
    second_col = df[selected]

    data = [
        {"x": time, "y": val}
        for time, val in zip(time_col.tolist(), second_col.tolist())
    ]

    return JsonResponse(
        {
            "data": [
                {
                    "label": f"{catchment_id}-{selected}",
                    "data": data,
                }
            ],
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
def getCatchmentVariables(request):
    """Variables available to shade the map, for this run only."""
    model_run_id = request.GET.get("model_run_id")
    if not model_run_id:
        return JsonResponse({"error": "model_run_id is required"})
    return JsonResponse(get_catchment_variables(model_run_id))


@controller
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


@controller
def getTrouteVariables(request):
    vars = []
    model_run_id = request.GET.get("model_run_id")
    troute_id = request.GET.get("troute_id")
    clean_troute_id = troute_id.split("-")[1]
    df = get_troute_df(model_run_id)

    if df is None:
        vars = []
    else:
        try:
            if check_troute_id(df, clean_troute_id):
                vars = get_troute_vars(df)
            else:
                vars = []
        except Exception:
            vars = []

    return JsonResponse({"troute_variables": vars})


@controller
def getTrouteTimeSeries(request):
    model_run_id = request.GET.get("model_run_id")
    troute_id = request.GET.get("troute_id")

    # Any digit run in the id: a bare '2863626' used to raise IndexError on split('-')[1].
    match = re.search(r"\d+", troute_id or "")
    if match is None:
        return JsonResponse({"error": f"Not a usable troute id: {troute_id!r}"})
    clean_troute_id = match.group()

    df = get_troute_df(model_run_id)

    # The client omits a null variable on the first load, so the server picks one -- the same
    # thing getCatchmentTimeSeries already does. Without this, variable_column stayed None and
    # .title() below raised outside the try, turning a missing parameter into a 500.
    available = [variable["value"] for variable in get_troute_vars(df)]
    requested = request.GET.get("troute_variable")
    variable_column = requested if requested in available else (available[0] if available else None)
    if variable_column is None:
        return JsonResponse({"error": "This model run has no plottable troute variables."})

    try:
        if isinstance(df.index, pd.MultiIndex):
            # Multi-indexed DataFrame: Slice using `feature_id` in the multi-index
            df_sliced_by_id = df.xs(int(clean_troute_id), level="feature_id")
            time_col = df_sliced_by_id.index.get_level_values("time")
        else:
            # Flat-indexed DataFrame: Filter using `featureID` column
            df_sliced_by_id = df[df["featureID"] == int(clean_troute_id)]
            time_col = df_sliced_by_id["current_time"]

        var_col = df_sliced_by_id[variable_column]

        data = [
            {
                "x": (
                    time.strftime("%Y-%m-%d %H:%M:%S")
                    if isinstance(time, pd.Timestamp)
                    else str(time)
                ),
                "y": val,
            }
            for time, val in zip(time_col.tolist(), var_col.tolist())
        ]
    except Exception as e:
        print(f"Error: {e}")
        data = []

    return JsonResponse(
        {
            "data": [
                {
                    "label": f"{troute_id}-{variable_column}",
                    "data": data,
                }
            ],
            "variable": variable_column,
            "troute_variables": get_troute_vars(df),
            "layout": {
                "yaxis": variable_column.title(),
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
    if _detect_legacy_teehr_layout(model_run_id) or not _teehr_warehouse_path():
        return []
    config_name = _resolve_configuration_name(model_run_id)
    if config_name is None:
        return []
    try:
        with _open_warehouse() as reader:
            return reader.list_configurations_for_run(config_name) or []
    except TeehrWarehouseError as exc:
        logger.warning("Could not list TEEHR variables: %s", exc)
        return []


@controller
def getTeehrTimeSeries(request):
    # Inputs: model_run_id (the registered run), teehr_id (USGS gauge like
    # "usgs-02464000"), teehr_variable ("<config>-<variable>" e.g.
    # "ngen_ngiab-streamflow_hourly_inst"). The config coming from the
    # dropdown is authoritative -- we don't re-derive it here.
    teehr_id = request.GET.get("teehr_id")
    model_run_id = request.GET.get("model_run_id")

    if not _teehr_warehouse_path():
        return _empty_ts_response(None, "TEEHR warehouse is not configured. See setup docs.", "info")

    # The client omits a null variable on the first load, so the server picks one. Requiring
    # the dropdown to be authoritative meant nothing ever plotted until the user chose, and
    # the dropdown had nothing in it to choose from.
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
        with _open_warehouse() as reader:
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
            "No TEEHR data for this location in the configured warehouse.",
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
def getTeehrVariables(request):
    model_run_id = request.GET.get("model_run_id")

    if _detect_legacy_teehr_layout(model_run_id):
        return _empty_variables_response(
            "This run has legacy TEEHR output. Re-run TEEHR with the current image to view results.",
            "warning",
        )

    if not _teehr_warehouse_path():
        return _empty_variables_response(
            "TEEHR warehouse is not configured. See setup docs.",
            "info",
        )

    config_name = _resolve_configuration_name(model_run_id)
    if config_name is None:
        return _empty_variables_response(
            "No TEEHR evaluation found for this run.",
            "info",
        )

    try:
        with _open_warehouse() as reader:
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
def getTeehrLocations(request):
    """Return the nexus/USGS pairs that actually have TEEHR results for this run.

    Lets the map colour geometry by TEEHR availability, filtered to this run's
    configuration and to gauges that have something to compare against.
    """
    model_run_id = request.GET.get("model_run_id")

    if _detect_legacy_teehr_layout(model_run_id):
        return _empty_locations_response(
            "This run has legacy TEEHR output. Re-run TEEHR with the current image to view results.",
            "warning",
        )

    if not _teehr_warehouse_path():
        return _empty_locations_response(
            "TEEHR warehouse is not configured. See setup docs.",
            "info",
        )

    config_name = _resolve_configuration_name(model_run_id)
    if config_name is None:
        return _empty_locations_response(
            "No TEEHR evaluation found for this run.",
            "info",
        )

    try:
        with _open_warehouse() as reader:
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


