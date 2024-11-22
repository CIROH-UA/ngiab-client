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
    find_gpkg_file,
    append_ngen_usgs_column,
    append_nwm_usgs_column,
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


@controller(app_workspace=True)
def getCatchmentTimeSeries(request, app_workspace):
    catchment_id = request.GET.get("catchment_id")
    variable_column = request.GET.get("variable_column")
    base_output_path = get_base_output(app_workspace)

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
            "catchment_ids": getCatchmentsIds(app_workspace),
        }
    )


@controller(app_workspace=True)
def getGeoSpatialData(request, app_workspace):
    response_object = {}

    gepackage_file_name = find_gpkg_file(app_workspace)
    gepackage_file_path = os.path.join(
        app_workspace.path, "ngen-data", "config", gepackage_file_name
    )
    gdf = gpd.read_file(gepackage_file_path, layer="nexus")
    # Append ngen_usgs and nwm_usgs columns
    gdf = append_ngen_usgs_column(gdf, app_workspace)
    gdf = append_nwm_usgs_column(gdf, app_workspace)

    # Load the GeoJSON file into a GeoPandas DataFrame
    gdf = gdf.to_crs("EPSG:4326")

    flow_paths_ids = gdf["toid"].tolist()
    bounds = gdf.total_bounds.tolist()

    data = json.loads(gdf.to_json())

    teerh_gdf = gdf[gdf["ngen_usgs"] != "none"]
    teerh_data = json.loads(teerh_gdf.to_json())

    response_object["nexus"] = data
    response_object["nexus_ids"] = getNexusList(app_workspace)
    response_object["bounds"] = bounds
    response_object["teerh"] = teerh_data
    response_object["catchments"] = getCatchmentsList(app_workspace)
    response_object["flow_paths_ids"] = flow_paths_ids
    return JsonResponse(response_object)


@controller(app_workspace=True)
def getNexusTimeSeries(request, app_workspace):
    nexus_id = request.GET.get("nexus_id")
    base_output_path = get_base_output(app_workspace)

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

    usgs_id = get_usgs_from_ngen_id(app_workspace, nexus_id)
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
            "nexus_ids": getNexusIDs(app_workspace),
            "usgs_id": usgs_id,
        }
    )


@controller(app_workspace=True)
def getTrouteVariables(request, app_workspace):
    vars = []
    troute_id = request.GET.get("troute_id")
    clean_troute_id = troute_id.split("-")[1]
    df = get_troute_df(app_workspace)

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


@controller(app_workspace=True)
def getTrouteTimeSeries(request, app_workspace):
    troute_id = request.GET.get("troute_id")
    clean_troute_id = troute_id.split("-")[1]
    variable_column = request.GET.get("troute_variable")
    df = get_troute_df(app_workspace)

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


@controller(app_workspace=True)
def getTeehrTimeSeries(request, app_workspace):
    teehr_id = request.GET.get("teehr_id")
    teehr_config_variable = request.GET.get("teehr_variable")
    teehr_configuration = teehr_config_variable.split("-")[0]
    teehr_variable = teehr_config_variable.split("-")[1]
    teehr_ts_path = get_teehr_joined_ts_path(
        app_workspace, teehr_configuration, teehr_variable
    )
    teehr_ts = get_teehr_ts(teehr_ts_path, teehr_id, teehr_configuration)
    teehr_metrics = get_teehr_metrics(app_workspace, teehr_id)
    return JsonResponse(
        {
            "metrics": teehr_metrics,
            "data": teehr_ts,
            "layout": {"yaxis": teehr_variable.title(), "xaxis": "", "title": ""},
        }
    )


@controller(app_workspace=True)
def getTeehrVariables(request, app_workspace):
    try:
        vars = get_configuration_variable_pairs(app_workspace)
    except Exception:
        vars = []
    return JsonResponse({"teehr_variables": vars})
