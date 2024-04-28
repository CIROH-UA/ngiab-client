import geopandas as gpd
import argparse
from geo.Geoserver import Geoserver
import shutil
import os


def convert_gpkg_to_geojson(gpkg_path, layer_name, output_path):
    """
    Convert a layer from a GeoPackage to a GeoJSON file, projected to EPSG:4326.

    Parameters:
    - gpkg_path: Path to the GeoPackage file.
    - layer_name: Name of the layer in the GeoPackage to convert.
    - output_path: Path where the output GeoJSON file should be saved.
    """
    # Load the specified layer from the GeoPackage
    gdf = gpd.read_file(gpkg_path, layer=layer_name)

    # Check and transform the coordinate system to EPSG:4326 if needed
    if gdf.crs.to_string() != "EPSG:4326":
        gdf = gdf.to_crs(epsg=4326)

    # Save the GeoDataFrame as a GeoJSON file
    gdf.to_crs(f"EPSG:4326").to_file(output_path, driver="GeoJSON")


def get_remove_unimportant_nexus():
    pass


def publish_gpkg_layer_to_geoserver(
    gpkg_path,
    layer_name,
    shp_path,
    geoserver_host,
    geoserver_port,
    geoserver_username,
    geoserver_password,
):
    # convert to shapefile to uploaded to geoserver
    gdf = gpd.read_file(gpkg_path, layer=layer_name)

    gdf.to_crs(f"EPSG:4326").to_file(f"{shp_path}.shp")

    # zip it
    shp_files = [f"{shp_path}.{ext}" for ext in ["shp", "shx", "dbf", "prj"]]

    # Using shutil to create a zip archive containing all shapefile components
    with shutil.ZipFile(f"{shp_path}.zip", "w") as zipf:
        for file in shp_files:
            zipf.write(file, arcname=os.path.basename(file))

    # Optional: Remove the shapefile files after zipping, if you don't need them
    for file in shp_files:
        os.remove(file)

    geo = Geoserver(
        f"{geoserver_host}:{geoserver_port}/geoserver",
        username=geoserver_username,
        password=geoserver_password,
    )
    geo.create_workspace(workspace="ngiab")

    geo.create_shp_datastore(
        path=f"{shp_path}.zip",
        store_name="hydrofabrics",
        workspace="ngiab",
    )


def main():
    # Setup argument parser
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
    # Parse arguments
    args = parser.parse_args()
    # Call the function with parsed arguments
    convert_gpkg_to_geojson(args.gpkg_path, args.layer_name, args.output_path)
    if args.publish:
        publish_gpkg_layer_to_geoserver(args.gpkg_path, args.shp_path)


if __name__ == "__main__":
    main()
