import geopandas as gpd
import argparse
from geo.Geoserver import Geoserver
import os
import zipfile


def read_and_transform(gpkg_path, layer_name):
    gdf = gpd.read_file(gpkg_path, layer=layer_name)
    if gdf.crs.to_string() != "EPSG:5070":
        gdf = gdf.to_crs(epsg=5070)
    return gdf


def create_and_publish_shp(
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
    geo.create_workspace(workspace="nextgen")

    geo.create_shp_datastore(
        path=f"{shp_path}.zip",
        store_name="hydrofabrics",
        workspace="nextgen",
    )
    # remove zip file
    os.remove(f"{shp_path}.zip")


def convert_gpkg_to_geojson(gpkg_path, layer_name, output_path):
    try:
        gdf = read_and_transform(gpkg_path, layer_name)
        gdf.to_file(output_path, driver="GeoJSON")
        return 0
    except Exception as e:
        print(f"Error in convert_gpkg_to_geojson: {e}")
        return 1


def publish_gpkg_layer_to_geoserver(
    gpkg_path,
    layer_name,
    shp_path,
    geoserver_host,
    geoserver_port,
    geoserver_username,
    geoserver_password,
):
    try:
        gdf = read_and_transform(gpkg_path, layer_name)
        create_and_publish_shp(
            gdf,
            shp_path,
            geoserver_host,
            geoserver_port,
            geoserver_username,
            geoserver_password,
        )
        return 0
    except Exception as e:
        print(f"Error in publish_gpkg_layer_to_geoserver: {e}")
        return 1


def publish_geojson_layer_to_geoserver(
    geojson_path,
    shp_path,
    geoserver_host,
    geoserver_port,
    geoserver_username,
    geoserver_password,
):
    try:
        gdf = read_and_transform(geojson_path, None)
        create_and_publish_shp(
            gdf,
            shp_path,
            geoserver_host,
            geoserver_port,
            geoserver_username,
            geoserver_password,
        )
        return 0
    except Exception as e:
        print(f"Error in publish_geojson_layer_to_geoserver: {e}")
        return 1


def main():
    parser = argparse.ArgumentParser(
        description="Tool for converting and publishing geospatial data"
    )
    parser.add_argument(
        "--convert_to_geojson",
        action="store_true",
        help="Convert GeoPackage to GeoJSON",
    )
    parser.add_argument(
        "--publish", action="store_true", help="Publish the layer to GeoServer"
    )
    parser.add_argument(
        "--publish_geojson",
        action="store_true",
        help="Publish the GeoJSON layer to GeoServer",
    )

    # Optional Arguments
    parser.add_argument(
        "--gpkg_path", help="Path to the GeoPackage file", required=False
    )
    parser.add_argument(
        "--layer_name",
        help="Name of the layer in the GeoPackage to convert",
        required=False,
    )
    parser.add_argument(
        "--output_path", help="Output path for the GeoJSON file", required=False
    )
    parser.add_argument(
        "--geojson_path", help="Path to the GeoJSON file", required=False
    )
    parser.add_argument(
        "--shp_path", help="Path to save the shapefile for GeoServer", required=False
    )
    parser.add_argument("--geoserver_host", help="GeoServer host", required=False)
    parser.add_argument("--geoserver_port", help="GeoServer port", required=False)
    parser.add_argument(
        "--geoserver_username", help="GeoServer username", required=False
    )
    parser.add_argument(
        "--geoserver_password", help="GeoServer password", required=False
    )

    args = parser.parse_args()

    if args.convert_to_geojson:
        if not args.gpkg_path or not args.layer_name or not args.output_path:
            parser.error(
                "--convert_to_geojson requires --gpkg_path, --layer_name, and --output_path."
            )
        result = convert_gpkg_to_geojson(
            args.gpkg_path, args.layer_name, args.output_path
        )
        exit(result)

    if args.publish:
        if not args.gpkg_path or not args.layer_name or not args.shp_path:
            parser.error(
                "--publish requires --gpkg_path, --layer_name, and --shp_path."
            )
        result = publish_gpkg_layer_to_geoserver(
            args.gpkg_path,
            args.layer_name,
            args.shp_path,
            args.geoserver_host,
            args.geoserver_port,
            args.geoserver_username,
            args.geoserver_password,
        )
        exit(result)

    if args.publish_geojson:
        if not args.geojson_path or not args.shp_path:
            parser.error("--publish_geojson requires --geojson_path and --shp_path.")
        result = publish_geojson_layer_to_geoserver(
            args.geojson_path,
            args.shp_path,
            args.geoserver_host,
            args.geoserver_port,
            args.geoserver_username,
            args.geoserver_password,
        )
        exit(result)


if __name__ == "__main__":
    main()
