import geopandas as gpd
from geo.Geoserver import Geoserver
import zipfile
import os


def _read_and_transform(gpkg_path, layer_name):
    gdf = gpd.read_file(gpkg_path, layer=layer_name)
    if gdf.crs.to_string() != "EPSG:5070":
        gdf = gdf.to_crs(epsg=5070)
    return gdf


def _create_and_publish_shp(
    gdf,
    shp_path,
    geoserver_host,
    geoserver_port,
    geoserver_username,
    geoserver_password,
):
    gdf.to_file(f"{shp_path}.shp", driver="ESRI Shapefile")
    shp_files = [f"{shp_path}.{ext}" for ext in ["shp", "shx", "dbf", "prj"]]

    with zipfile.ZipFile(f"{shp_path}.zip", "w") as zipf:
        for file in shp_files:
            zipf.write(file, arcname=os.path.basename(file))

    # remove shapefiles
    for file in shp_files:
        os.remove(file)

    geo = Geoserver(
        f"http://{geoserver_host}:{geoserver_port}/geoserver",
        username=geoserver_username,
        password=geoserver_password,
    )

    geo.create_shp_datastore(
        path=f"{shp_path}.zip",
        store_name="hydrofabrics",
        workspace="nextgen",
    )
    # remove zip file
    os.remove(f"{shp_path}.zip")
