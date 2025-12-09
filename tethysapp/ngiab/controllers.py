from django.http import JsonResponse, HttpResponse
import pandas as pd
import os
import io
import pyarrow as pa
import json
import geopandas as gpd
from tethys_sdk.routing import controller

from .data_utils import (
    convert_nc_2_df,
)
from .app import App
import logging

# the following error is fixed with this lines
# https://stackoverflow.com/a/79163867
import pyproj

pyproj.network.set_network_enabled(False)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

@controller
def home(request):
    """Controller for the app home page."""
    # The index.html template loads the React frontend
    return App.render(request, "index.html")


@controller
def getParquetPerVpu(request):
    print("Getting parquet file per vpu...")
    file_prefix_list =  json.loads(request.body.decode("utf-8"))['nc_files']
    vpu_gpkg = json.loads(request.body.decode("utf-8"))['vpu_gpkg']
    dfs = []
    for file_prefix in file_prefix_list:
        df = convert_nc_2_df(
            s3_nc_url=file_prefix,
            s3_gpkg_url=vpu_gpkg,
        )
        dfs.append(df)
    complete_df = pd.concat(dfs, ignore_index=True)
    # breakpoint()
    print(complete_df.head())
    table = pa.Table.from_pandas(complete_df)

    buf = io.BytesIO()
    with pa.ipc.new_stream(buf, table.schema) as writer:
        writer.write_table(table)
    buf.seek(0)

    return HttpResponse(
        buf.read(),
        content_type="application/vnd.apache.arrow.stream",
    )