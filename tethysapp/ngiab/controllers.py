from django.http import JsonResponse
import pandas as pd
import os
import json
import geopandas as gpd
from tethys_sdk.routing import controller
from .utils import (
    get_base_output,
    getCatchmentsIds,
    getNexusIDs,
    getNexusList,
    check_troute_id,
    get_troute_vars,
    get_troute_df,
    get_configuration_variable_pairs,
    get_teehr_joined_ts_path,
    get_teehr_ts,
    get_teehr_metrics,
    get_usgs_from_ngen_id,
    getCatchmentsList,
    find_gpkg_file_path,
    append_ngen_usgs_column,
    append_nwm_usgs_column,
    get_model_runs_selectable,
)
from .datastream_utils import (
    list_public_s3_folders,
    get_select_from_s3,
    remove_forcings_from_forecast_list,
    make_datastream_conf,
    download_and_extract_tar_from_s3,
    get_dates_select_from_s3,
    get_datastream_model_runs_selectable,
    check_if_datastream_data_exists,
    get_datastream_id_from_conf_file
)

from .app import App

# the following error is fixed with this lines
# https://stackoverflow.com/a/79163867
import pyproj

pyproj.network.set_network_enabled(False)


@controller
def home(request):
    """Controller for the app home page."""
    # The index.html template loads the React frontend
    return App.render(request, "index.html")


@controller
def importModelRuns(request):
    print("Importing model runs...")
    response_object = {}
    model_run_name = request.GET.get("model_run_name")
    model_run_s3_path = request.GET.get("model_run_s3_path")
    response_object["model_run_name"] = model_run_name
    response_object["model_run_s3_path"] = model_run_s3_path
    return JsonResponse(response_object)
    


@controller
def getModelRuns(request):
    print("Getting model runs...")
    model_run_select =  get_model_runs_selectable()
    return JsonResponse({
        "model_runs": model_run_select
    })


@controller
def getCatchmentTimeSeries(request):
    model_run_id = request.GET.get("model_run_id")
    catchment_id = request.GET.get("catchment_id")
    variable_column = request.GET.get("variable_column")
    base_output_path = get_base_output(model_run_id)

    catchment_output_file_path = os.path.join(
        base_output_path,
        "{}.csv".format(catchment_id),
    )

    df = pd.read_csv(catchment_output_file_path)
    list_variables = df.columns.tolist()[2:]  # remove time and timestep
    time_col = df.iloc[:, 1]
    if variable_column is None:
        second_col = df.iloc[:, 2]
    else:
        second_col = df[variable_column]

    data = [
        {"x": time, "y": val}
        for time, val in zip(time_col.tolist(), second_col.tolist())
    ]

    return JsonResponse(
        {
            "data": [
                {
                    "label": f"{catchment_id}-{variable_column if variable_column else list_variables[0]}",
                    "data": data,
                }
            ],
            "variables": [
                {"value": variable, "label": variable.lower().replace("_", " ")}
                for variable in list_variables
            ],
            "variable": (
                # {"value": variable_column, "label": variable_column.lower()}
                variable_column
                if variable_column
                else list_variables[0]
            ),
            "layout": {
                "yaxis": variable_column,
                "xaxis": "",
                "title": "",
            },
            "catchment_ids": getCatchmentsIds(model_run_id),
        }
    )


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
    df = pd.read_csv(nexus_output_file_path, header=None)

    time_col = df.iloc[:, 1]
    streamflow_cms_col = df.iloc[:, 2]
    data = [
        {"x": time, "y": streamflow}
        for time, streamflow in zip(time_col.tolist(), streamflow_cms_col.tolist())
    ]

    usgs_id = get_usgs_from_ngen_id(model_run_id, nexus_id)
    return JsonResponse(
        {
            "data": [
                {
                    "label": f"{nexus_id}-Streamflow",
                    "data": data,
                }
            ],
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
    clean_troute_id = troute_id.split("-")[1]
    variable_column = request.GET.get("troute_variable")
    df = get_troute_df(model_run_id)

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
            "layout": {
                "yaxis": variable_column.title(),
                "xaxis": "",
                "title": "",
            },
        }
    )


@controller
def getTeehrTimeSeries(request):

    teehr_id = request.GET.get("teehr_id")
    model_run_id = request.GET.get("model_run_id")
    teehr_config_variable = request.GET.get("teehr_variable")
    teehr_configuration = teehr_config_variable.split("-")[0]
    teehr_variable = teehr_config_variable.split("-")[1]
    teehr_ts_path = get_teehr_joined_ts_path(
        model_run_id, teehr_configuration, teehr_variable
    )
    teehr_ts = get_teehr_ts(teehr_ts_path, teehr_id, teehr_configuration)
    teehr_metrics = get_teehr_metrics(model_run_id, teehr_id)
    return JsonResponse(
        {
            "metrics": teehr_metrics,
            "data": teehr_ts,
            "layout": {"yaxis": teehr_variable.title(), "xaxis": "", "title": ""},
        }
    )


@controller
def getTeehrVariables(request):
    model_run_id = request.GET.get("model_run_id")
    try:
        vars = get_configuration_variable_pairs(model_run_id)
    except Exception:
        vars = []
    return JsonResponse({"teehr_variables": vars})


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
def getDataStreamTarFile(request):
    """
    Get the tar file from the bucket.
    """
    print("Getting tar file from the bucket...")
    avail_date = request.GET.get("avail_date")
    ngen_forecast = request.GET.get("ngen_forecast")
    ngen_vpu = request.GET.get("ngen_vpu")
    tar_path = f"v2.2/{avail_date}/{ngen_forecast}/{ngen_vpu}/ngen-run.tar.gz"
    if request.GET.get("ngen_cycle") is not None:
        ngen_cycle = request.GET.get("ngen_cycle")
        tar_path = f"v2.2/{avail_date}/{ngen_forecast}/{ngen_cycle}/{ngen_vpu}/ngen-run.tar.gz"
    if request.GET.get("ngen_ensemble") is not None:
        ngen_ensemble = request.GET.get("ngen_ensemble")
        tar_path = f"v2.2/{avail_date}/{ngen_forecast}/{ngen_cycle}/{ngen_ensemble}/{ngen_vpu}/ngen-run.tar.gz"
    name_folder = f"{avail_date}_{ngen_forecast}_{ngen_vpu}"
    data_was_downloaded = check_if_datastream_data_exists(name_folder)
    if data_was_downloaded:
        unique_id = get_datastream_id_from_conf_file(name_folder)
    else:
        unique_id = download_and_extract_tar_from_s3(tar_key=tar_path,name_folder=name_folder) 
    return JsonResponse({"id": unique_id})


@controller
def getDataStreamModelRuns(request):
    datastream_model_run_select =  get_datastream_model_runs_selectable()
    return JsonResponse({
        "datastream_model_runs": datastream_model_run_select
    })