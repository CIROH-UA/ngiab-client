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
    check_troute_id,
    get_troute_vars,
    get_troute_df,
)

from .app import App


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
            "data": data,
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
            "catchment_ids": getCatchmentsIds(app_workspace),
        }
    )


@controller(app_workspace=True)
def getNexuslayer(request, app_workspace):
    response_object = {}
    nexus_file_path = os.path.join(
        app_workspace.path, "ngen-data", "config", "nexus.geojson"
    )

    # Load the GeoJSON file into a GeoPandas DataFrame
    gdf = gpd.read_file(nexus_file_path)

    # Convert the DataFrame to the "EPSG:3857" coordinate system
    gdf = gdf.to_crs("EPSG:3857")
    data = json.loads(gdf.to_json())

    response_object["geojson"] = data
    # response_object["list_ids"] = nexus_select_list
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

    return JsonResponse(
        {
            "data": data,
            "nexus_ids": getNexusIDs(app_workspace),
        }
    )


@controller(app_workspace=True)
def getTrouteVariables(request, app_workspace):
    troute_id = request.GET.get("troute_id")
    clean_troute_id = troute_id.split("-")[1]
    df = get_troute_df(app_workspace)
    try:
        if check_troute_id(df, clean_troute_id):
            vars = get_troute_vars(df)
        else:
            vars = []
    except Exception as e:
        vars = []

    return JsonResponse({"troute_variables": vars})


@controller(app_workspace=True)
def getTrouteTimeSeries(request, app_workspace):
    troute_id = request.GET.get("troute_id")
    clean_troute_id = troute_id.split("-")[1]
    variable_column = request.GET.get("troute_variable")
    df = get_troute_df(app_workspace)
    df_sliced_by_id = df[df["feature_id"] == int(clean_troute_id)]

    df_sliced_by_id["t0"] = pd.to_datetime(df_sliced_by_id["t0"].iloc[0])

    # Convert the time_offset column to timedelta
    df_sliced_by_id["time"] = pd.to_timedelta(df_sliced_by_id["time"])

    df_sliced_by_id["t1"] = df_sliced_by_id["t0"] + df_sliced_by_id["time"]
    try:
        time_col = df_sliced_by_id["t1"]
        var_col = df_sliced_by_id[variable_column]
        data = [
            {"x": time, "y": val}
            for time, val in zip(time_col.tolist(), var_col.tolist())
        ]
    except Exception as e:
        data = []

    return JsonResponse({"data": data})
