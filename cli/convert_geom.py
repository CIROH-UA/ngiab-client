import argparse
from geo.Geoserver import Geoserver
from .utils import _read_and_transform, _create_and_publish_shp


def create_workspace(
    geoserver_host, geoserver_port, geoserver_username, geoserver_password
):
    try:
        geo = Geoserver(
            f"http://{geoserver_host}:{geoserver_port}/geoserver",
            username=geoserver_username,
            password=geoserver_password,
        )
        geo.create_workspace(workspace="nextgen")

    except Exception as e:
        print(f"Error in create_workspace: {e}")
        return 1
    return 0


def convert_gpkg_to_geojson(gpkg_path, layer_name, output_path):
    try:
        gdf = _read_and_transform(gpkg_path, layer_name)
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
        gdf = _read_and_transform(gpkg_path, layer_name)
        _create_and_publish_shp(
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
        gdf = _read_and_transform(geojson_path, None)
        _create_and_publish_shp(
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
    parser.add_argument(
        "--create_workspace",
        action="store_true",
        help="Create a workspace in GeoServer",
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

    if args.create_workspace:
        if (
            not args.geoserver_host
            or not args.geoserver_port
            or not args.geoserver_username
            or not args.geoserver_password
        ):
            parser.error(
                "--create_workspace requires --geoserver_host, --geoserver_port, --geoserver_username, and --geoserver_password."
            )
        result = create_workspace(
            args.geoserver_host,
            args.geoserver_port,
            args.geoserver_username,
            args.geoserver_password,
        )
        exit(result)


if __name__ == "__main__":
    main()
