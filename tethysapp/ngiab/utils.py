import os
import json
import re
import logging
import pandas as pd
import glob
import duckdb
import xarray as xr
from collections import defaultdict

from django.core.exceptions import ValidationError

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

def _import_runs_from_json_once():
    """Copy any runs still living in ngiab_visualizer.json into the database.

    Existing installs have their runs in that file, written by viewOnTethys.sh. Importing
    lazily -- only when the table is empty -- means an upgrade keeps every registered run
    without a migration step the user has to remember, and re-running is a no-op.

    The file stays on disk untouched: it is still what the launcher writes when importing a
    run into a container that is not running yet.
    """
    from .models import ModelRun

    conf_file = _get_conf_file()
    if not os.path.exists(conf_file):
        return

    try:
        with open(conf_file, "r") as f:
            data = json.load(f)
    except (OSError, ValueError) as exc:
        logger.warning("Could not read %s for import: %s", conf_file, exc)
        return

    for entry in data.get("model_runs", []):
        run_id = entry.get("id")
        if not run_id:
            continue
        # Preserve the existing id so links of the form ?model_run_id=<uuid> keep working.
        try:
            ModelRun.objects.get_or_create(
                id=run_id,
                defaults={
                    "label": entry.get("label", ""),
                    "path": entry.get("path", ""),
                    "subset": entry.get("subset", "") or "",
                    "tags": entry.get("tags", []) or [],
                    "teehr_configuration_name": entry.get("teehr_configuration_name", "") or "",
                },
            )
        except (ValueError, ValidationError) as exc:
            # A non-UUID id in a hand-edited file must not take the whole import down.
            logger.warning("Skipping model run %r during import: %s", run_id, exc)


def _get_list_model_runs():
    """Return the registered model runs, in the shape callers already expect.

    The database is now the source of truth. This keeps returning
    ``{"model_runs": [...]}`` so every existing caller -- _get_model_run_path_by_id,
    _resolve_configuration_name, get_model_runs_selectable -- works unchanged.
    """
    from .models import ModelRun

    if not ModelRun.objects.exists():
        _import_runs_from_json_once()

    return {"model_runs": [run.as_dict() for run in ModelRun.objects.all()]}


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


# Output files may be csv (as ngen writes them) or parquet (as viewOnTethys.sh rewrites
# them at import). Parquet first: when both exist it is the cheaper read.
_OUTPUT_SUFFIXES = (".parquet", ".csv")


def _list_prefixed_output_files(directory, prefix):
    """Return the ids of output files with ``prefix``, without their extension.

    Matches parquet as well as csv. viewOnTethys.sh converts a run's outputs at import and
    deletes the csv copies, so globbing ``*.csv`` alone would report a converted run as
    having no catchments -- an empty map that looks exactly like a broken one.

    Deduplicated by stem, so a partially converted directory containing both ``cat-1.csv``
    and ``cat-1.parquet`` lists that catchment once.
    """
    if not os.path.exists(directory):
        logger.info("Output directory does not exist: %s", directory)
        return []

    stems = set()
    for name in os.listdir(directory):
        if not name.startswith(prefix):
            continue
        for suffix in _OUTPUT_SUFFIXES:
            if name.endswith(suffix):
                stems.add(name[: -len(suffix)])
                break

    return sorted(stems)


def _find_output_file(directory, stem):
    """Return (path, suffix) for a run output, preferring parquet, or raise."""
    for suffix in _OUTPUT_SUFFIXES:
        path = os.path.join(directory, f"{stem}{suffix}")
        if os.path.exists(path):
            return path, suffix
    raise FileNotFoundError(f"No output file for {stem!r} in {directory}")


def _read_output_columns(directory, stem):
    """List an output file's column names without reading its rows.

    For parquet this is answered from the footer (LIMIT 0 reads no row groups), which is
    what lets the caller then ask for just the two columns it needs.
    """
    path, suffix = _find_output_file(directory, stem)
    if suffix == ".parquet":
        rel = duckdb.query(f"SELECT * FROM read_parquet('{path}') LIMIT 0")
        return list(rel.columns)
    return list(pd.read_csv(path, nrows=0).columns)


def _read_output_frame(directory, stem, columns=None, time_column=None):
    """Read one output file as a DataFrame, preferring parquet.

    ``columns`` matters: parquet is columnar, so selecting two of seventeen columns reads
    roughly two-seventeenths of the file. Without it the format change buys nothing --
    measured, SELECT * from parquet is slower than read_csv, because the whole point is
    projection rather than raw scan speed.

    DuckDB rather than pd.read_parquet, which needs pyarrow: not installed, and a sizeable
    addition when duckdb is already a dependency for TEEHR.
    """
    path, suffix = _find_output_file(directory, stem)

    if suffix == ".parquet":
        # Quoted so column names containing spaces (e.g. "Time Step") survive.
        #
        # time_column is cast to VARCHAR deliberately. Parquet stores it as a TIMESTAMP, so
        # without the cast the JSON encoder serialises 43k datetime objects instead of
        # passing strings through -- measured at 54 ms against 9 ms, which wiped out the
        # entire read saving and made parquet slower end to end than CSV. The cast also
        # yields '2017-01-01 00:00:00', byte-identical to what the CSV path returns, so the
        # response shape does not change with the storage format.
        selected = columns if columns else ["*"]
        parts = []
        for column in selected:
            if column == "*":
                parts.append("*")
            elif time_column and column == time_column:
                parts.append(f'CAST("{column}" AS VARCHAR) AS "{column}"')
            else:
                parts.append(f'"{column}"')
        return duckdb.query(f"SELECT {', '.join(parts)} FROM read_parquet('{path}')").df()

    return pd.read_csv(path, usecols=list(columns) if columns else None)


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
    catchment_ids_list = _list_prefixed_output_files(output_base_file, catchment_prefix)
    return [{"value": id, "label": id} for id in catchment_ids_list]


def getCatchmentsList(model_id):
    output_base_file = get_base_output(model_id)
    catchment_prefix = "cat-"
    return _list_prefixed_output_files(output_base_file, catchment_prefix)


def getNexusList(model_id):
    output_base_file = get_base_output(model_id)
    nexus_prefix = "nex-"
    nexus_ids_list = _list_prefixed_output_files(output_base_file, nexus_prefix)
    return [id.split("_output")[0] for id in nexus_ids_list]


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
    nexus_ids_list = _list_prefixed_output_files(output_base_file, nexus_prefix)
    return [
        {"value": id.split("_output")[0], "label": id.split("_output")[0]}
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

