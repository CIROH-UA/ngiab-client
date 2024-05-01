import geopandas as gpd
import argparse
from geo.Geoserver import Geoserver
import shutil
import os
import zipfile


def convert_gpkg_to_geojson(gpkg_path, layer_name, output_path):
    gdf = gpd.read_file(gpkg_path, layer=layer_name)

    if gdf.crs.to_string() != "EPSG:4326":
        gdf = gdf.to_crs(epsg=4326)

    gdf.to_file(output_path, driver="GeoJSON")


def publish_gpkg_layer_to_geoserver(
    gpkg_path,
    layer_name,
    shp_path,
    geoserver_host,
    geoserver_port,
    geoserver_username,
    geoserver_password,
):
    gdf = gpd.read_file(gpkg_path, layer=layer_name)

    gdf.to_crs(f"EPSG:4326").to_file(f"{shp_path}.shp", driver="ESRI Shapefile")

    shp_files = [f"{shp_path}.{ext}" for ext in ["shp", "shx", "dbf", "prj"]]

    with zipfile.ZipFile(f"{shp_path}.zip", "w") as zipf:
        for file in shp_files:
            zipf.write(file, arcname=os.path.basename(file))

    for file in shp_files:
        os.remove(file)

    geo = Geoserver(
        f"http://{geoserver_host}:{geoserver_port}/geoserver",
        username=geoserver_username,
        password=geoserver_password,
    )
    geo.create_workspace(workspace="nextgen")

    geo.create_shp_datastore(
        path=f"{shp_path}.zip",
        store_name="hydrofabrics",
        workspace="nextgen",
    )


def main():
    parser = argparse.ArgumentParser(
        description="Convert a GeoPackage layer to GeoJSON format with projection to EPSG:4326."
    )
    parser.add_argument("gpkg_path", help="Path to the GeoPackage file.")
    parser.add_argument("layer_name", help="Name of the layer to convert.")
    parser.add_argument("output_path", help="Output path for the GeoJSON file.")
    parser.add_argument(
        "--publish", action="store_true", help="Publish the layer to GeoServer."
    )
    parser.add_argument("--shp_path", help="Path to save the shapefile for GeoServer.")
    parser.add_argument("--geoserver_host", help="GeoServer host.")
    parser.add_argument("--geoserver_port", help="GeoServer port.")
    parser.add_argument("--geoserver_username", help="GeoServer username.")
    parser.add_argument("--geoserver_password", help="GeoServer password.")

    args = parser.parse_args()

    convert_gpkg_to_geojson(args.gpkg_path, args.layer_name, args.output_path)

    if args.publish:
        publish_gpkg_layer_to_geoserver(
            args.gpkg_path,
            args.layer_name,
            args.shp_path,
            args.geoserver_host,
            args.geoserver_port,
            args.geoserver_username,
            args.geoserver_password,
        )


if __name__ == "__main__":
    main()
