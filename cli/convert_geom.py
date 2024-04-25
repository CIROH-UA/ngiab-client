import geopandas as gpd
import argparse


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


def main():
    # Setup argument parser
    parser = argparse.ArgumentParser(
        description="Convert a GeoPackage layer to GeoJSON format with projection to EPSG:4326."
    )
    parser.add_argument("gpkg_path", help="Path to the GeoPackage file.")
    parser.add_argument("layer_name", help="Name of the layer to convert.")
    parser.add_argument("output_path", help="Output path for the GeoJSON file.")

    # Parse arguments
    args = parser.parse_args()

    # Call the function with parsed arguments
    convert_gpkg_to_geojson(args.gpkg_path, args.layer_name, args.output_path)


if __name__ == "__main__":
    main()
