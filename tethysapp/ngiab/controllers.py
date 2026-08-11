from django.http import JsonResponse
from django.core.exceptions import ValidationError
import logging
import pandas as pd
import os
import json
import re
import geopandas as gpd
import duckdb
from tethys_sdk.routing import controller
from .utils import (
    get_base_output,
    _read_output_frame,
    _read_output_columns,
    getCatchmentsIds,
    getNexusIDs,
    getNexusList,
    check_troute_id,
    get_troute_vars,
    get_troute_df,
    get_usgs_from_ngen_id,
    getCatchmentsList,
    find_gpkg_file_path,
    append_ngen_usgs_column,
    append_nwm_usgs_column,
    get_model_runs_selectable,
    get_catchment_variables,
    get_catchment_value_matrix,
    _resolve_configuration_name,
    _detect_legacy_teehr_layout,
    _open_warehouse,
    _teehr_warehouse_path,
)
from .teehr_warehouse import (
    ConfigurationNotFound,
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
from .datastream_utils import (
    list_public_s3_folders,
    get_select_from_s3,
    remove_forcings_from_forecast_list,
    make_datastream_conf,
    download_and_extract_tar_from_s3,
    get_dates_select_from_s3,
    get_datastream_model_runs_selectable,
    check_if_datastream_data_exists,
    get_datastream_id_from_conf_file,
    check_if_s3_file_exists
)

from .app import App
from botocore.exceptions import ClientError, BotoCoreError

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
    context = {"app_root_url": f"/apps/{App.root_url}/"}
    return App.render(request, "index.html", context)


@controller
def importModelRuns(request):
    response_object = {}
    model_run_name = request.GET.get("model_run_name")
    model_run_s3_path = request.GET.get("model_run_s3_path")
    response_object["model_run_name"] = model_run_name
    response_object["model_run_s3_path"] = model_run_s3_path
    return JsonResponse(response_object)
    


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
    response_object = {}
    model_run_id = request.GET.get("model_run_id")

    # gepackage_file_name = find_gpkg_file(model_run_id)
    try:
        gepackage_file_path = find_gpkg_file_path(model_run_id)
    except Exception as e:
        return JsonResponse({"error": "Failed to read GeoPackage file."})
    # Append ngen_usgs and nwm_usgs columns
    gdf = gpd.read_file(gepackage_file_path, layer="nexus")
    gdf = append_ngen_usgs_column(gdf, model_run_id)
    gdf = append_nwm_usgs_column(gdf, model_run_id)

    # Load the GeoJSON file into a GeoPandas DataFrame
    gdf = gdf.to_crs("EPSG:4326")

    flow_paths_ids = gdf["toid"].tolist()
    bounds = gdf.total_bounds.tolist()

    data = json.loads(gdf.to_json())

    response_object["nexus"] = data
    response_object["nexus_ids"] = getNexusList(model_run_id)
    response_object["bounds"] = bounds
    # response_object["teerh"] = teerh_data
    response_object["catchments"] = getCatchmentsList(model_run_id)
    response_object["flow_paths_ids"] = flow_paths_ids
    return JsonResponse(response_object)


@controller
def getNexusTimeSeries(request):
    model_run_id = request.GET.get("model_run_id")
    nexus_id = request.GET.get("nexus_id")
    base_output_path = get_base_output(model_run_id)

    nexus_output_file_path = os.path.join(
        base_output_path,
        "{}_output.csv".format(nexus_id),
    )
    usgs_id = get_usgs_from_ngen_id(model_run_id, nexus_id)
    data_key = []
    
    if os.path.exists(nexus_output_file_path):
        try:
            df = pd.read_csv(nexus_output_file_path, header=None)
            time_col = df.iloc[:, 1]
            streamflow_cms_col = df.iloc[:, 2]
            data = [
                {"x": time, "y": streamflow}
                for time, streamflow in zip(time_col.tolist(), streamflow_cms_col.tolist())
            ]
            data_key =[
                {
                "label": f"{nexus_id}-Streamflow",
                "data": data,
                }
            ]
        except Exception as e:
            print(f"Error reading CSV file: {e}")
            data_key = []
        
    else:
        data_key = []
    
    return JsonResponse(
        {
            "data": data_key,
            "layout": {
                "yaxis": "Streamflow",
                "xaxis": "",
                "title": "",
            },
            "nexus_ids": getNexusIDs(model_run_id),
            "usgs_id": usgs_id,
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

    Lets the map colour geometry by TEEHR availability. Distinct from the ``ngen_usgs``
    column on ``getGeoSpatialData``'s nexus features: that reports the warehouse-wide
    crosswalk (``list_crosswalks`` with no configuration filter), so it also includes
    gauges this run never evaluated. This is filtered to the run's configuration.
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


@controller
def makeDatastreamConf(request):
    """
    Create the datastream configuration file.
    """
    print("Creating datastream configuration file...")
    try:
        make_datastream_conf()
        return JsonResponse({"status": "success"})
    except Exception as e:
        return JsonResponse({"status": "error", "message": str(e)})

@controller
def getDataStreamNgiabDates(request):
    """
    Get the list of dates in the bucket.
    """
    print("Getting list of dates in the bucket...")
    ngen_dates = list_public_s3_folders(prefix="v2.2/")
    ngen_dates = [date for date in ngen_dates if date != "ngen.20250429"] # small patch, this date has both the new and old format
    list_dates = get_dates_select_from_s3(ngen_dates)
    
    
    return JsonResponse({"ngen_dates": list_dates})

@controller
def getDataStreamNgiabAvailableForecast(request):
    """
    Get the list of available forecast in the bucket.
    """
    print("Getting list of available forecast in the bucket...")
    avail_date = request.GET.get("avail_date")
    ngen_forecast = list_public_s3_folders(prefix=f"v2.2/{avail_date}/")
    clean_forecast_list = remove_forcings_from_forecast_list(ngen_forecast)
    list_forecast = get_select_from_s3(clean_forecast_list)
    return JsonResponse({"ngen_forecast": list_forecast})


@controller
def getDataStreamNgiabAvailableVpus(request):
    """
    Get the list of available vpus
    """
    print("Getting list of available vpus in the bucket...")
    avail_date = request.GET.get("avail_date")
    ngen_forecast = request.GET.get("ngen_forecast")
    prefix_path = f"v2.2/{avail_date}/{ngen_forecast}/"
    if request.GET.get("ngen_cycle") is not None:
        ngen_cycle = request.GET.get("ngen_cycle")
        prefix_path = f"v2.2/{avail_date}/{ngen_forecast}/{ngen_cycle}/"
    if request.GET.get("ngen_ensemble") is not None:
        ngen_ensemble = request.GET.get("ngen_ensemble")
        prefix_path = f"v2.2/{avail_date}/{ngen_forecast}/{ngen_cycle}/{ngen_ensemble}/"

    ngen_vpu = list_public_s3_folders(prefix=prefix_path)
    dict_vpus = get_select_from_s3(ngen_vpu)
    return JsonResponse({"ngen_vpus": dict_vpus})


@controller
def getDataStreamNgiabAvailableCycles(request):
    print("Getting list of available cycles in the bucket...")
    avail_date = request.GET.get("avail_date")
    ngen_forecast = request.GET.get("ngen_forecast")
    prefix_path = f"v2.2/{avail_date}/{ngen_forecast}/"
    ngen_cycles = list_public_s3_folders(prefix=prefix_path)
    dict_cycles = get_select_from_s3(ngen_cycles)
    return JsonResponse({"ngen_cycles": dict_cycles})

@controller
def getDataStreamNgiabAvailableEnsembles(request):
    print("Getting list of available ensembles in the bucket...")
    avail_date = request.GET.get("avail_date")
    ngen_forecast = request.GET.get("ngen_forecast")
    ngen_cycle = request.GET.get("ngen_cycle")
    prefix_path = f"v2.2/{avail_date}/{ngen_forecast}/{ngen_cycle}/"
    ngen_ensembles = list_public_s3_folders(prefix=prefix_path)
    dict_ensembles = get_select_from_s3(ngen_ensembles)
    return JsonResponse({"ngen_ensembles": dict_ensembles, "need_ensembles": True})

@controller
def checkForTarFile(request):
    """
    Check tar from S3

    Query-string parameters
    -----------------------
    avail_date      – YYYY-MM-DD (e.g. 2025-05-11)
    ngen_forecast   – forecast identifier
    ngen_vpu        – VPU identifier
    ngen_cycle      – (optional) cycle identifier
    ngen_ensemble   – (optional) ensemble identifier
    """
    avail_date    = request.GET.get("avail_date")
    ngen_forecast = request.GET.get("ngen_forecast")
    ngen_vpu      = request.GET.get("ngen_vpu")
    ngen_cycle    = request.GET.get("ngen_cycle")      # may be None
    ngen_ensemble = request.GET.get("ngen_ensemble")   # may be None

    # ── Build the S3 key and local folder name ────────────────────────────
    parts = ["v2.2", avail_date, ngen_forecast]
    if ngen_cycle:
        parts.append(ngen_cycle)
    if ngen_ensemble:
        parts.append(ngen_ensemble)
    parts.append(ngen_vpu)

    tar_key     = "/".join(parts) + "/ngen-run.tar.gz"
    
    isDataOnBucket = check_if_s3_file_exists(tar_key=tar_key)

    return JsonResponse({"isDataOnBucket": isDataOnBucket})

@controller
def getDataStreamTarFile(request):
    """
    Download a datastream tar from S3 (if not cached locally) and return its ID.

    Query-string parameters
    -----------------------
    avail_date      – YYYY-MM-DD (e.g. 2025-05-11)
    ngen_forecast   – forecast identifier
    ngen_vpu        – VPU identifier
    ngen_cycle      – (optional) cycle identifier
    ngen_ensemble   – (optional) ensemble identifier
    """
    avail_date    = request.GET.get("avail_date")
    ngen_forecast = request.GET.get("ngen_forecast")
    ngen_vpu      = request.GET.get("ngen_vpu")
    ngen_cycle    = request.GET.get("ngen_cycle")      # may be None
    ngen_ensemble = request.GET.get("ngen_ensemble")   # may be None

    # ── Build the S3 key and local folder name ────────────────────────────
    parts = ["v2.2", avail_date, ngen_forecast]
    if ngen_cycle:
        parts.append(ngen_cycle)
    if ngen_ensemble:
        parts.append(ngen_ensemble)
    parts.append(ngen_vpu)

    tar_key     = "/".join(parts) + "/ngen-run.tar.gz"
    name_folder = "_".join(filter(None, [avail_date, ngen_forecast, ngen_cycle, ngen_ensemble, ngen_vpu]))

    # ── Fast path: already downloaded ─────────────────────────────────────
    if check_if_datastream_data_exists(name_folder):
        unique_id = get_datastream_id_from_conf_file(name_folder)
        return JsonResponse({"id": unique_id}, status=200)

    # ── Slow path: download + extract ─────────────────────────────────────
    try:
        unique_id = download_and_extract_tar_from_s3(
            tar_key=tar_key,
            name_folder=name_folder,
        )
    except FileNotFoundError:
        # The object simply isn’t in the bucket.
        msg = (
            "No datastream archive was found for the requested parameters "
            f"({avail_date}, forecast={ngen_forecast}, vpu={ngen_vpu}"
            f"{', cycle='+ngen_cycle if ngen_cycle else ''}"
            f"{', ensemble='+ngen_ensemble if ngen_ensemble else ''})."
        )
        return JsonResponse({"msg": msg}, status=404)

    except (ClientError, BotoCoreError) as e:
        # Connectivity, permissions, throttling, etc.
        msg = (
            "There was a problem downloading the datastream archive from S3. "
            "Please try again later or contact support."
        )
        # Optional: attach a short hint for diagnostics.
        return JsonResponse({"msg": msg, "detail": str(e)}, status=502)

    except Exception as e:
        # Any other error (e.g. tar extraction).
        msg = (
            "There was a problem extracting the datastream archive. "
            "Please try again later or contact support."
        )
        # Optional: attach a short hint for diagnostics.
        return JsonResponse({"msg": msg, "detail": str(e)}, status=502)
    # ── Success ───────────────────────────────────────────────────────────
    return JsonResponse({"id": unique_id}, status=200)

@controller
def getDataStreamModelRuns(request):
    datastream_model_run_select =  get_datastream_model_runs_selectable()
    return JsonResponse({
        "datastream_model_runs": datastream_model_run_select
    })