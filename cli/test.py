import geopandas as gpd
import sys


def convert_geojson_to_shapefile(geojson_path, shapefile_path):
    """
    Converts a GeoJSON file to a Shapefile.

    Parameters:
        geojson_path (str): The file path for the GeoJSON file.
        shapefile_path (str): The output file path for the Shapefile.
    """
    # Load the GeoJSON file into a GeoDataFrame
    gdf = gpd.read_file(geojson_path)

    # Convert the GeoDataFrame to a Shapefile
    gdf.to_file(shapefile_path, driver="ESRI Shapefile")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python convert_geojson_to_shp.py <GeoJSON_path> <Shapefile_path>")
        sys.exit(1)

    geojson_path = sys.argv[1]
    shapefile_path = sys.argv[2]

    convert_geojson_to_shapefile(geojson_path, shapefile_path)
    print("Conversion complete.")


# python cli/test.py /home/gio/tethysdev/docker/NextGen/ngen-data/AWI_09_004/config/catchments.geojson cli/catchments.shp
