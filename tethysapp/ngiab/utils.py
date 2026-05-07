import os
import json
import re
import logging
import pandas as pd
import glob
import duckdb
import xarray as xr
from collections import defaultdict

from .teehr_warehouse import (
    ConfigurationNotFound,
    TeehrWarehouseError,
    UnsupportedWarehouseVersion,
    WarehouseCatalogLocked,
    WarehouseMountMirrorBroken,
    WarehouseReader,
    WarehouseUnreachable,
)

logger = logging.getLogger(__name__)

# ---- TEEHR warehouse integration helpers ----------------------------------


def _teehr_warehouse_path():
    """Return the configured TEEHR warehouse path (from env), or None."""
    return os.environ.get("TEEHR_WAREHOUSE_PATH")


def _sanitize_stem(basename: str) -> str:
    """Apply the same sanitization teehr uses to build ``ngen_<stem>``.

    Keep in sync with ``ngiab-teehr/scripts/teehr_ngen.py`` ``re.sub`` rule.
    """
    return re.sub(r"[^a-zA-Z0-9_]", "_", basename).lower()


def _resolve_configuration_name(model_run_id):
    """Resolve the teehr ``ngen_<stem>`` configuration name for this run.

    Precedence (see plan FR2):
      1. ``teehr_configuration_name`` field in ``ngiab_visualizer.json`` (written by
         ``viewOnTethys.sh`` from the producer's manifest). Authoritative — never
         overruled by derivation.
      2. Fallback: derive from the run's ``path`` basename using the same
         sanitization teehr applies, and validate against the warehouse
         ``configurations`` table.

    Returns the configuration name or None if it cannot be resolved.
    """
    model_runs = _get_list_model_runs().get("model_runs", [])
    entry = next((m for m in model_runs if m.get("id") == model_run_id), None)
    if entry is None:
        return None
    persisted = entry.get("teehr_configuration_name")
    if persisted:
        return persisted
    path = entry.get("path")
    if not path:
        return None
    derived = "ngen_" + _sanitize_stem(os.path.basename(path.rstrip("/")))
    warehouse = _teehr_warehouse_path()
    if not warehouse:
        return None
    try:
        with WarehouseReader(warehouse) as reader:
            if reader.configuration_exists(derived):
                return derived
    except TeehrWarehouseError:
        logger.info("Fallback configuration validation skipped; warehouse unavailable")
        return None
    return None


def _detect_legacy_teehr_layout(model_run_id):
    """Return True if the run dir still has pre-PR ``<run>/teehr/metrics.csv``."""
    model_path = _get_model_run_path_by_id(model_run_id)
    if model_path is None:
        return False
    return os.path.exists(os.path.join(model_path, "teehr", "metrics.csv"))


def _open_warehouse():
    """Open a WarehouseReader from TEEHR_WAREHOUSE_PATH. Returns None if unset.

    Caller is responsible for closing (or using a `with` block on the result).
    """
    path = _teehr_warehouse_path()
    if not path:
        return None
    return WarehouseReader(path)

def _get_conf_file():
    home_path = os.environ.get("HOME", "/tmp")
    conf_base_path = os.environ.get("VISUALIZER_CONF", f"{home_path}/ngiab_visualizer/ngiab_visualizer.json")
    print(conf_base_path)
    return conf_base_path

def _get_list_model_runs():
    """
        {
            "model_runs": [
                {
                    "label": "run1",
                    "path": "/home/aquagio/tethysdev/ciroh/ngen/ngen-data/AWI_16_2863657_007",
                    "date": "2021-01-01:00:00:00",
                    "id": "AWI_16_2863657_007",
                    "subset": "cat-2863657_subset", #to_implement
                    "tags": ["tag1", "tag2"], #to_implement
                },
                ....
            ]
        }
    """
    print("get_list_model_runs")
    conf_file = _get_conf_file()
    
    with open(conf_file, "r") as f:
        data = json.load(f)
    return data

def get_model_runs_selectable():
    
    model_runs = _get_list_model_runs()
    return [
        {
            "value": model_run["id"], 
            "label": model_run["label"]
        }
        for model_run in model_runs["model_runs"]
    ]

def _find_gpkg_file_path(model_path):
    config_path = os.path.join(model_path, "config")
    gpkg_files = []

    for root, dirs, files in os.walk(config_path):
        for file in files:
            if file.endswith(".gpkg"):
                gpkg_files.append(os.path.join(root, file))

    return gpkg_files[0]

def _get_model_run_path_by_id(id):
    model_runs = _get_list_model_runs()
    for model_run in model_runs["model_runs"]:

        if model_run["id"] == id:
            return model_run["path"]
    return None

def find_gpkg_file_path(model_run_id):
    gpkg_model_run_path = None
    model_path = _get_model_run_path_by_id(model_run_id)
    if model_path is not None:
        gpkg_model_run_path = _find_gpkg_file_path(model_path)
        # breakpoint()
        # gpkg_model_run_path = f'{model_path}/config/{file_name}'
    return gpkg_model_run_path



def append_ngen_usgs_column(gdf, model_id):
    """Add ``ngen_usgs`` column mapping nexus IDs on the map to USGS gauge IDs.

    Reads the warehouse's ``location_crosswalks`` table filtered to ngen entries.
    Rows with no matching USGS gauge get ``"none"``. Warehouse unreachable or
    absent → every row gets ``"none"``.
    """
    try:
        reader = _open_warehouse()
        if reader is None:
            gdf["ngen_usgs"] = "none"
            return gdf
        with reader:
            crosswalks = reader.list_crosswalks(secondary_prefix="ngen")
    except TeehrWarehouseError as exc:
        logger.info("append_ngen_usgs_column: warehouse unavailable (%s)", exc)
        gdf["ngen_usgs"] = "none"
        return gdf
    # secondary is "ngen-XXXXX"; the gpkg nexus IDs are "nex-XXXXX". Map accordingly.
    nex_to_usgs = {
        secondary.replace("ngen-", "nex-", 1): primary
        for primary, secondary in crosswalks
    }
    gdf["ngen_usgs"] = gdf["id"].apply(lambda x: nex_to_usgs.get(x, "none"))
    return gdf


def append_nwm_usgs_column(gdf, model_id):
    """Add ``nwm_usgs`` column mapping USGS gauge IDs to NWM reach IDs.

    Depends on ``ngen_usgs`` already being present on the GeoDataFrame (call
    ``append_ngen_usgs_column`` first). Reads the warehouse's
    ``location_crosswalks`` filtered to ``nwm30`` entries.
    """
    try:
        reader = _open_warehouse()
        if reader is None:
            gdf["nwm_usgs"] = "none"
            return gdf
        with reader:
            crosswalks = reader.list_crosswalks(secondary_prefix="nwm30")
    except TeehrWarehouseError as exc:
        logger.info("append_nwm_usgs_column: warehouse unavailable (%s)", exc)
        gdf["nwm_usgs"] = "none"
        return gdf
    usgs_to_nwm = {primary: secondary for primary, secondary in crosswalks}
    gdf["nwm_usgs"] = gdf["ngen_usgs"].apply(lambda x: usgs_to_nwm.get(x, "none"))
    return gdf


def _get_base_troute_output(model_id):
    base_path = _get_model_run_path_by_id(model_id)    
    base_output_path = os.path.join(
        base_path, "outputs", "troute"
    )
    return base_output_path


def get_troute_df(model_id):
    """
    Load the first T-Route data file from the workspace as a DataFrame.
    Supports both CSV and NetCDF (.nc) files, and replaces NaN values with -9999.
    """
    base_output_path = _get_base_troute_output(model_id)

    # Search for supported file types in priority order
    file_types = [("CSV", "*.csv"), ("NetCDF", "*.nc")]

    for file_type, pattern in file_types:
        files = glob.glob(os.path.join(base_output_path, pattern))

        if files:
            file_path = files[0]
            print(f"Found {file_type} file: {file_path}")

            try:
                if file_type == "CSV":
                    # Read the CSV file into a DataFrame
                    df = pd.read_csv(file_path)
                elif file_type == "NetCDF":
                    # Read the NetCDF file and convert to a DataFrame
                    ds = xr.open_dataset(file_path)
                    df = ds.to_dataframe()

                # Replace NaN values with -9999
                df.fillna(-9999, inplace=True)
                return df
            except Exception as e:
                print(f"Error reading {file_type} file '{file_path}': {e}")

    # If no files found, return None
    print(f"No supported T-Route output files found in {base_output_path}.")
    return None


def get_base_output(model_id):
    base_path = _get_model_run_path_by_id(model_id)
    # print(base_path)
    output_relative_path = get_output_path(base_path).split("outputs")[-1]
    base_output_path = os.path.join(
        base_path, "outputs", output_relative_path.strip("/")
    )
    return base_output_path

def get_output_path(base_path):
    """
    Retrieve the value of the 'output_root' key from a JSON file.

    Args:
    json_filepath (str): The file path of the JSON file.

    Returns:
    str: The value of the 'output_root' key or None if the key doesn't exist.
    """
    
    realizations_output_path = os.path.join(
        base_path, "config", "realization.json"
    )

    try:
        with open(realizations_output_path, "r") as file:
            data = json.load(file)
        return data.get("output_root", None)
    except FileNotFoundError:
        print(f"Error: The file {realizations_output_path} does not exist.")
        return None
    except json.JSONDecodeError:
        print("Error: Failed to decode JSON.")
        return None
    except Exception as e:
        print(f"An error occurred: {e}")
        return None


def _list_prefixed_csv_files(directory, prefix):
    """
    List all CSV files in a specified directory that start with a given prefix.

    Args:
    directory (str): The directory to search for files.
    prefix (str): The prefix the file names should start with.

    Returns:
    list: A list of filenames (str) that match the criteria.
    """
    # Check if the directory exists
    if not os.path.exists(directory):
        print("The specified directory does not exist.")
        return []

    # List all files in the directory
    files = os.listdir(directory)

    # Filter files to find those that are CSVs and start with the given prefix
    csv_files = [
        file for file in files if file.startswith(prefix) and file.endswith(".csv")
    ]

    return csv_files


def getCatchmentsIds(model_run_id):
    """
    Get a list of catchment IDs.

    Parameters:
        app_workspace (str): The path to the application workspace.

    Returns:
        list: A list of dictionaries containing catchment IDs and labels.
              Each dictionary has the keys 'value' and 'label'.
    """
    output_base_file = get_base_output(model_run_id)
    catchment_prefix = "cat-"
    catchment_ids_list = _list_prefixed_csv_files(output_base_file, catchment_prefix)
    return [
        {"value": id.split(".csv")[0], "label": id.split(".csv")[0]}
        for id in catchment_ids_list
    ]


def getCatchmentsList(model_id):
    output_base_file = get_base_output(model_id)
    catchment_prefix = "cat-"
    catchment_ids_list = _list_prefixed_csv_files(output_base_file, catchment_prefix)
    return [id.split(".csv")[0] for id in catchment_ids_list]


def getNexusList(model_id):
    output_base_file = get_base_output(model_id)
    nexus_prefix = "nex-"
    nexus_ids_list = _list_prefixed_csv_files(output_base_file, nexus_prefix)
    return [id.split(".csv")[0].split("_output")[0] for id in nexus_ids_list]


def getNexusIDs(model_run_id):
    """
    Get a list of Nexus IDs.

    Parameters:
        app_workspace (str): The path to the application workspace.

    Returns:
        list: A list of dictionaries containing the Nexus IDs. Each dictionary has a 'value' and 'label' key.
    """
    output_base_file = get_base_output(model_run_id)
    nexus_prefix = "nex-"
    nexus_ids_list = _list_prefixed_csv_files(output_base_file, nexus_prefix)
    return [
        {"value": id.split("_output.csv")[0], "label": id.split("_output.csv")[0]}
        for id in nexus_ids_list
    ]


def get_usgs_from_ngen_id(model_run_id, nexus_id):
    """Return the USGS gauge id for a map nexus id (e.g. ``nex-485431``), or None.

    Reads the warehouse's ``location_crosswalks`` table. Warehouse unreachable →
    returns None.
    """
    corrected = nexus_id.replace("nex-", "ngen-", 1) if nexus_id.startswith("nex-") else nexus_id
    try:
        reader = _open_warehouse()
        if reader is None:
            return None
        with reader:
            crosswalks = reader.list_crosswalks(secondary_prefix="ngen")
    except TeehrWarehouseError as exc:
        logger.info("get_usgs_from_ngen_id: warehouse unavailable (%s)", exc)
        return None
    for primary, secondary in crosswalks:
        if secondary == corrected:
            return primary
    return None


def get_troute_vars(df):
    # Check if the DataFrame has a MultiIndex
    if isinstance(df.index, pd.MultiIndex):
        # For multi-indexed DataFrame
        list_variables = df.columns.tolist()  # All columns are variables
    else:
        # For flat-indexed DataFrame
        list_variables = df.columns.tolist()[
            3:
        ]  # Skip the first three columns (featureID, Type, time)

    # Format the variables for display
    variables = [
        {"value": variable, "label": variable.lower()} for variable in list_variables
    ]
    return variables


def check_troute_id(df, id):
    if isinstance(df.index, pd.MultiIndex):
        # Multi-indexed DataFrame: Check in the `feature_id` level
        return int(id) in df.index.get_level_values("feature_id")
    else:
        # Flat-indexed DataFrame: Check in the `featureID` column
        return int(id) in df["featureID"].values

