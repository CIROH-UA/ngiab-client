from django.http import JsonResponse
import pandas as pd
import os
import json
import geopandas as gpd
from tethys_sdk.routing import controller
from .app import App


@controller
def home(request):
    """Controller for the app home page."""

    # The index.html template loads the React frontend

    return App.render(request, "index.html")


@controller(app_workspace=True)
def getNexuslayer(request, app_workspace):
    # nexus_file_path = os.path.join(app_workspace.path, "nexus.geojson")
    # with open(nexus_file_path, "r") as a_file:
    #     data = json.load(a_file)

    # return JsonResponse(data)
    nexus_file_path = os.path.join(
        app_workspace.path, "ngen-data", "config", "nexus.geojson"
    )

    # Load the GeoJSON file into a GeoPandas DataFrame
    gdf = gpd.read_file(nexus_file_path)

    # Convert the DataFrame to the "EPSG:3857" coordinate system
    gdf = gdf.to_crs("EPSG:3857")

    # Convert the DataFrame back to a GeoJSON object
    data = json.loads(gdf.to_json())

    return JsonResponse(data)


@controller(app_workspace=True)
def getNexusTimeSeries(request, app_workspace):
    # breakpoint()
    nexus_id = request.GET.get("nexus_id")
    nexus_output_file_path = os.path.join(
        app_workspace.path, "ngen-data", "outputs", "nex-{}_output.csv".format(nexus_id)
    )
    df = pd.read_csv(nexus_output_file_path, header=None)
    time_col = df.iloc[:, 1]
    streamflow_cms_col = df.iloc[:, 2]
    sreamflow_cfs_col = streamflow_cms_col * 35.314  # Convert to cfs
    data = {"x": time_col.tolist(), "y": sreamflow_cfs_col.tolist()}

    return JsonResponse(data)


@controller
def data(request):
    """API controller for the plot page."""
    # Download example data from GitHub
    df = pd.read_csv(
        "https://raw.githubusercontent.com/plotly/datasets/master/finance-charts-apple.csv"
    )

    # Do data processing in Python
    l_date = df["Date"].tolist()

    # Then return JSON containing data
    return JsonResponse(
        {
            "series": [
                {"title": "AAPL High", "x": l_date, "y": df["AAPL.High"].tolist()},
                {"title": "AAPL Low", "x": l_date, "y": df["AAPL.Low"].tolist()},
            ],
        }
    )
