import os
import json
import re
import math
import functools
import sqlite3
import base64
import logging
import numpy as np
import pandas as pd
import glob
import xarray as xr
import pyogrio
from pyproj import Transformer


from . import duckdb_conn, manifest, run_store
from .teehr_warehouse import (
    TeehrWarehouseError,
    WarehouseReader,
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
      1. The run's ``teehr_configuration_name`` column, captured at registration from
         the producer's manifest. Authoritative - never overruled by derivation.
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


def teehr_source(model_run_id):
    """Pick a TEEHR reader for this run: its own evaluation, else the shared warehouse.

    Returns ``(open_reader, configuration_name)``, or ``(None, None)`` when neither is
    available. ``open_reader`` is a callable so the caller keeps the ``with`` block and both
    readers close the same way.

    The per-run evaluation wins when present because it is what the documented workflow
    writes -- guide.sh, or the ngiab-teehr image against a run directory -- and it describes
    that run and no other. The warehouse is the shared-catalog arrangement, addressed by
    TEEHR_WAREHOUSE_PATH and keyed by an ngen_<stem> configuration per run.
    """
    from .teehr_evaluation import RUN_CONFIGURATION, EvaluationReader, evaluation_dir

    dataset = evaluation_dir(_get_model_run_path_by_id(model_run_id))
    if dataset:
        return (lambda: EvaluationReader(dataset)), RUN_CONFIGURATION

    if not _teehr_warehouse_path():
        return None, None

    config_name = _resolve_configuration_name(model_run_id)
    if config_name is None:
        return None, None

    return _open_warehouse, config_name


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

def _entry_from_manifest(entry):
    """One run_store entry, in the dict shape every reader here already expects.

    ``subset`` and ``tags`` are gone: nothing ever wrote ``tags``, and ``subset`` was
    settable only through ``register_run`` and read by nothing. ``date`` keeps the odd
    ``%Y-%m-%d:%H:%M:%S`` spelling ModelRun.as_dict produced, because parity costs less than
    divergence for a field no view renders today.
    """
    document = entry["manifest"] or {}
    created = document.get("created") or ""
    return {
        "label": document.get("label") or entry["name"],
        "path": run_store.location(entry["name"]),
        "date": created.replace("T", ":")[:19] if created else "",
        "id": document.get("id") or entry["name"],
        "legacy_uuids": document.get("legacy_uuids") or [],
        "teehr_configuration_name": (document.get("teehr") or {}).get(
            "configuration_name", ""
        ),
    }


def _get_list_model_runs():
    """Return the registered model runs, in the shape callers already expect.

    The storage root is the registry now: a directory with a usable manifest under it is a
    registered run. Keeps returning ``{"model_runs": [...]}`` so every caller --
    _get_model_run_path_by_id, _resolve_configuration_name, get_model_runs_selectable,
    scan_importable_runs -- works unchanged. That contract is what makes removing the
    database a contained change rather than a sweep.

    Only usable runs are listed, which preserves today's split exactly: a directory the
    importer would have refused was never in the picker either. run_store keeps the
    unusable ones, with the reason, for the interface work in Unit 8.
    """
    return {
        "model_runs": [
            _entry_from_manifest(entry) for entry in run_store.list_runs() if entry["usable"]
        ]
    }


def get_model_runs_selectable():
    """The run picker's options.

    ``rescannable`` is vestigial and constant now. It told the removal confirmation whether
    the importer could offer a run again, which mattered while a run could be registered
    from outside the managed root; every run is under the storage root by definition today,
    so the answer is always yes. The field and the frontend branch reading it go together in
    Unit 8 -- dropping it here alone would flip that confirmation to its scarier wording for
    three units.
    """
    return [
        {
            "value": model_run["id"],
            "label": model_run["label"],
            "rescannable": True,
        }
        for model_run in _get_list_model_runs()["model_runs"]
    ]

# Where the launcher copies runs to, and the importer's default place to look.
MANAGED_ROOT = os.environ.get("NGIAB_MANAGED_ROOT", "/var/lib/tethys_persist/ngiab_visualizer")


def scan_roots():
    """Directories the importer offers runs from, outermost first.

    Defaults to the managed root, which is where viewOnTethys.sh puts runs. A deployment
    that mounts runs somewhere else lists those places in NGIAB_SCAN_ROOTS, because a run
    the importer cannot see is a run that unregistering removes for good.
    """
    declared = [r for r in os.environ.get("NGIAB_SCAN_ROOTS", "").split(os.pathsep) if r]
    roots, seen = [], set()
    for root in declared or [MANAGED_ROOT]:
        real = os.path.realpath(root)
        if real not in seen:
            seen.add(real)
            roots.append(root)
    return roots


def is_scannable(path):
    """Whether `path` sits directly inside one of the scan roots, symlinks resolved.

    realpath on both sides, so neither ``..`` in a name nor a symlink planted inside a root
    can name a directory outside every root.
    """
    if not path:
        return False
    real = os.path.realpath(path)
    return any(
        real != os.path.realpath(root) and real.startswith(os.path.realpath(root) + os.sep)
        for root in scan_roots()
    )


def teehr_name_from_manifest(path):
    """The producer's authoritative configuration name, if it travelled with the run.

    _resolve_configuration_name can derive this from the directory name, but a persisted
    value always wins, so it is captured at registration.

    The key is ``teehr_configuration_name``: ngiab-teehr writes that, and reading the
    unprefixed ``configuration_name`` returned empty for every real manifest.
    """
    manifest = os.path.join(path, "teehr_run_manifest.json")
    try:
        with open(manifest, "r") as f:
            return json.load(f).get("teehr_configuration_name", "") or ""
    except (OSError, ValueError):
        return ""


def _has_catchment_output(run_path):
    """True as soon as one catchment output is seen; never lists a whole outputs directory.

    A registered run can hold tens of thousands of files and gigabytes of warehouse beside
    them, so the scan stats known paths and stops at the first match rather than walking.
    """
    outputs = resolve_output_dir(run_path)
    try:
        with os.scandir(outputs) as entries:
            return any(
                e.name.startswith("cat-") and e.name.endswith(_OUTPUT_SUFFIXES)
                for e in entries
            )
    except OSError:
        return False


def describe_importable_run(run_path):
    """Report one candidate directory: what it has, and why it cannot be imported.

    Reported rather than filtered out, because a directory the user can see on disk and
    cannot see in the importer is indistinguishable from a bug.

    Returns None for anything outside the scan roots, so a caller passing a path of its own
    learns only that it is not something to import.
    """
    if not is_scannable(run_path) or not os.path.isdir(run_path):
        return None

    if _find_gpkg_file_path(run_path) is None:
        reason = "No GeoPackage in config/, so there is nothing to draw."
    elif not _has_catchment_output(run_path):
        reason = "No catchment outputs in outputs/ngen/, so there is nothing to plot."
    else:
        reason = None

    return {
        "path": run_path,
        "label": os.path.basename(run_path.rstrip(os.sep)),
        "importable": reason is None,
        "reason": reason,
    }


def scan_importable_runs():
    """Every directory inside the scan roots, with the registered ones marked.

    Registered is matched on the resolved path, so a run registered through a symlink is
    not offered a second time under its real name.
    """
    registered = {
        os.path.realpath(run["path"]) for run in _get_list_model_runs()["model_runs"]
    }

    candidates = []
    for root in scan_roots():
        try:
            with os.scandir(root) as entries:
                names = sorted(e.name for e in entries if e.is_dir())
        except OSError:
            logger.warning("Scan root is not readable: %s", root)
            continue

        for name in names:
            described = describe_importable_run(os.path.join(root, name))
            if described is None:
                continue
            described["registered"] = os.path.realpath(described["path"]) in registered
            candidates.append(described)

    return candidates


def _find_gpkg_file_path(model_path):
    config_path = os.path.join(model_path, "config")
    gpkg_files = []

    for root, dirs, files in os.walk(config_path):
        for file in files:
            if file.endswith(".gpkg"):
                gpkg_files.append(os.path.join(root, file))

    # A valid run whose config directory holds no gpkg is a real case, not an IndexError.
    return gpkg_files[0] if gpkg_files else None

class UnknownModelRun(Exception):
    """Raised when a request names a model run that is not registered.

    Kept separate from _get_model_run_path_by_id, which returns None on purpose: callers
    like _detect_legacy_teehr_layout want 'not applicable', not a failure.
    """


def _require_model_run_path(model_run_id):
    """The run's directory, or raise. Every path built from a run id goes through here."""
    path = _get_model_run_path_by_id(model_run_id)
    if path is None:
        raise UnknownModelRun(model_run_id)
    return path


def model_run_exists(model_run_id):
    """Whether a run id is registered. False for None, so a missing parameter is not a match."""
    return model_run_id is not None and _get_model_run_path_by_id(model_run_id) is not None


def _get_model_run_path_by_id(id):
    """Resolve a run id to its location, accepting the ids it answered to before.

    A shared ``?model_run_id=<uuid>`` link predates the manifest, so the migration records
    each run's former UUIDs and this matches them too. Both spellings are normalised first:
    Django stored a UUIDField in SQLite as 32 undashed hex characters, and a row written by
    anything else could hold the 36-character dashed form -- which reads back fine and never
    matches. migrations/0002 had to repair exactly that.
    """
    if id is None:
        return None

    wanted = manifest.normalize_uuid(id)
    for model_run in _get_list_model_runs()["model_runs"]:
        if model_run["id"] == id:
            return model_run["path"]
        if wanted and wanted in model_run.get("legacy_uuids", []):
            return model_run["path"]
    return None

def find_gpkg_file_path(model_run_id):
    return _find_gpkg_file_path(_require_model_run_path(model_run_id))







# Stands in for NaN between reading the file and serialising the response.
TROUTE_MISSING = -9999


def _get_base_troute_output(model_id):
    base_path = _require_model_run_path(model_id)
    return os.path.join(base_path, "outputs", "troute")


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
                    df.attrs["variable_meta"] = {
                        str(name): dict(ds[name].attrs) for name in ds.data_vars
                    }

                # A bare NaN is invalid JSON, so gaps travel as a sentinel and come back null.
                df.fillna(TROUTE_MISSING, inplace=True)
                return df
            except Exception as e:
                print(f"Error reading {file_type} file '{file_path}': {e}")

    # If no files found, return None
    print(f"No supported T-Route output files found in {base_output_path}.")
    return None


# Where ngen writes by default, and what the converter and the importer both assume.
_DEFAULT_OUTPUT_SUBDIR = "ngen"


def resolve_output_dir(base_path):
    """Where this run's catchment outputs live, from a run directory.

    realization.json names it with ``output_root``. A run without that file, or with one
    that does not declare it, falls back to ``outputs/ngen`` rather than raising: such runs
    exist, and get_base_output used to call .split on the None and return a 500 for every
    output endpoint.

    Shared with the importer's scan so the reader and the scan cannot disagree about
    whether a directory has outputs worth registering.
    """
    declared = get_output_path(base_path)
    relative = declared.split("outputs")[-1].strip("/") if declared else ""
    return os.path.join(base_path, "outputs", relative or _DEFAULT_OUTPUT_SUBDIR)


def get_base_output(model_id):
    return resolve_output_dir(_require_model_run_path(model_id))

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
        logger.info("No realization.json in %s; using the default output directory", base_path)
        return None
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Could not read %s: %s", realizations_output_path, exc)
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
        rel = duckdb_conn.query(
            f"SELECT * FROM read_parquet({duckdb_conn.quote(path)}) LIMIT 0"
        )
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

    ``time_column`` is cast to VARCHAR deliberately. Parquet stores it as a TIMESTAMP, and
    without the cast the JSON encoder serialised 43k datetime objects rather than passing
    strings through -- 54 ms against 9 ms, which wiped out the entire read saving and made
    parquet slower end to end than csv. The cast also yields '2017-01-01 00:00:00', which is
    byte-identical to the csv path, so the response shape does not change with the format.
    """
    path, suffix = _find_output_file(directory, stem)

    if suffix == ".parquet":
        # Quoted so column names containing spaces (e.g. "Time Step") survive.
        selected = columns if columns else ["*"]
        parts = []
        for column in selected:
            if column == "*":
                parts.append("*")
            elif time_column and column == time_column:
                parts.append(f'CAST("{column}" AS VARCHAR) AS "{column}"')
            else:
                parts.append(f'"{column}"')
        return duckdb_conn.query(
            f"SELECT {', '.join(parts)} FROM read_parquet({duckdb_conn.quote(path)})"
        )

    return pd.read_csv(path, usecols=list(columns) if columns else None)


# Frames the map animation may hold, and cells the response may carry. Both are ceilings on
# the payload, not on the data: exceeding either coarsens the time step, it never truncates.
_MAX_FRAMES = 2000
_MAX_CELLS = 4_000_000

# Coarsening ladder in hours, ending at roughly a month.
_BUCKET_HOURS = (1, 3, 6, 12, 24, 48, 168, 720)

# Bin 0 is reserved for no-data, so a missing value never renders as the lowest class.
_NO_DATA_BIN = 0
_CLASS_COUNT = 8


def _output_glob(directory, prefix="cat-"):
    """Return a DuckDB table expression reading every prefixed output at once."""
    for suffix in _OUTPUT_SUFFIXES:
        pattern = os.path.join(directory, f"{prefix}*{suffix}")
        if glob.glob(pattern):
            reader = "read_parquet" if suffix == ".parquet" else "read_csv"
            table = f"{reader}({duckdb_conn.quote(pattern)}, filename=true, union_by_name=true)"
            return table, suffix
    return None, None


def _union_columns(table):
    """Column names across every file in the glob, not just the first.

    union_by_name means a run whose catchments were produced by different formulations still
    reports the full set. LIMIT 0 answers this from parquet footers without reading rows.

    'filename' is dropped: it is synthesised by filename=true, not something the run wrote,
    and leaving it in offers it to the user as a plottable variable.
    """
    columns = list(duckdb_conn.query(f"SELECT * FROM {table} LIMIT 0").columns)
    return [name for name in columns if name != "filename"]


def _choose_bucket_hours(distinct_times, span_hours, catchment_count):
    """Pick the finest step that keeps the response under both ceilings.

    Returns None to mean "keep the run's native step", which is the common case for a short
    forecast run; only a long retrospective run gets coarsened.
    """
    if distinct_times <= 1:
        return None

    native = max(span_hours / (distinct_times - 1), 1e-9)

    def frames_at(hours):
        return math.ceil(span_hours / hours) + 1

    budget = _MAX_FRAMES
    if catchment_count:
        budget = min(budget, max(_MAX_CELLS // catchment_count, 1))

    if distinct_times <= budget:
        return None

    for hours in _BUCKET_HOURS:
        if hours >= native and frames_at(hours) <= budget:
            return hours
    return _BUCKET_HOURS[-1]


def _class_breaks(values):
    """Quantile breaks over the run's own distribution, deduplicated.

    Equal-interval breaks are useless here: this data is heavily zero-weighted and spans
    orders of magnitude between variables and between runs, so a fixed scale puts everything
    in one class. Deduplicating means a variable that is zero most of the time simply gets
    fewer classes rather than several identical ones.
    """
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return []

    quantiles = np.linspace(0, 1, _CLASS_COUNT + 1)[1:-1]
    breaks = np.quantile(finite, quantiles)
    lowest = float(finite.min())

    # A break at the minimum leaves the first class unreachable, so drop those.
    unique = []
    for value in breaks:
        value = float(value)
        if value <= lowest:
            continue
        if not unique or value > unique[-1]:
            unique.append(value)
    return unique


@functools.lru_cache(maxsize=32)
def _cached_catchment_variables(directory, fingerprint):
    """Keyed on the fingerprint so new or rewritten outputs invalidate it."""
    table, _ = _output_glob(directory)
    if table is None:
        return None
    return tuple(_union_columns(table))


def get_catchment_variables(model_run_id):
    """Variables this run actually wrote, in the order the output files declare them.

    Cached because the answer costs a schema read of every catchment file. Parquet answers
    from footers, but a run still in csv has to be sniffed file by file: measured on an
    8105-catchment run, 53.9 s as csv against 0.26 s once converted. Paying that on every
    page load left the shading control disabled for most of a minute.
    """
    directory = get_base_output(model_run_id)
    columns = _cached_catchment_variables(directory, _output_fingerprint(directory))
    if columns is None:
        return {"variables": [], "time_column": None}
    if len(columns) < 3:
        return {"variables": [], "time_column": None}

    # Same positional contract as getCatchmentTimeSeries: 0 is the step, 1 is the timestamp.
    return {"variables": list(columns[2:]), "time_column": columns[1]}


def _output_fingerprint(directory):
    """Cheap change detector for a run's output directory."""
    try:
        stat = os.stat(directory)
    except OSError:
        return None
    return (stat.st_mtime_ns, stat.st_size)


@functools.lru_cache(maxsize=8)
def _cached_value_matrix(directory, variable, fingerprint):
    return _build_value_matrix(directory, variable)


def get_catchment_value_matrix(model_run_id, variable=None):
    """Per-catchment values over time for one variable, quantised for a choropleth.

    Cached because scrubbing the timeline must not re-scan the outputs, and a full read costs
    seconds on csv. The fingerprint makes a converted or re-run directory miss the cache.

    The cached dict is handed straight to JsonResponse and must not be mutated by callers.
    """
    directory = get_base_output(model_run_id)
    return _cached_value_matrix(directory, variable, _output_fingerprint(directory))


def _build_value_matrix(directory, variable=None):
    """Everything here is derived from the run being asked about.

    Runs differ in which variables they wrote, over what period, at what step, and across what
    range of values, so none of those may be assumed or shared between runs.
    """
    table, _ = _output_glob(directory)

    empty = {
        "variable": None,
        "variables": [],
        "catchment_ids": [],
        "times": [],
        "breaks": [],
        "bins": "",
        "step_hours": None,
        "no_data_bin": _NO_DATA_BIN,
    }
    if table is None:
        return empty

    columns = _union_columns(table)
    if len(columns) < 3:
        return empty

    time_name = columns[1]
    variables = list(columns[2:])
    selected = variable if variable in variables else variables[0]

    time_expr = f'CAST("{time_name}" AS TIMESTAMP)'
    extent = duckdb_conn.fetchone(
        f"SELECT min({time_expr}), max({time_expr}), count(DISTINCT {time_expr}) FROM {table}"
    )
    start, end, distinct_times = extent
    if not distinct_times:
        return {**empty, "variable": selected, "variables": variables}

    catchment_count = len(_list_prefixed_output_files(directory, "cat-"))
    span_hours = max((end - start).total_seconds() / 3600.0, 0.0)
    bucket_hours = _choose_bucket_hours(distinct_times, span_hours, catchment_count)

    bucket_expr = (
        time_expr
        if bucket_hours is None
        else f"time_bucket(INTERVAL '{bucket_hours} hours', {time_expr})"
    )

    # The catchment id comes from the filename because the rows themselves do not carry it.
    frame = duckdb_conn.query(
        f"""
        SELECT
            CAST(regexp_extract(filename, 'cat-(\\d+)', 1) AS BIGINT) AS catchment,
            {bucket_expr} AS bucket,
            avg("{selected}") AS value
        FROM {table}
        WHERE regexp_extract(filename, 'cat-(\\d+)', 1) <> ''
        GROUP BY 1, 2
        ORDER BY 2, 1
        """
    )

    if frame.empty:
        return {**empty, "variable": selected, "variables": variables}

    catchments = np.sort(frame["catchment"].unique())
    buckets = np.sort(frame["bucket"].unique())

    catchment_pos = {value: index for index, value in enumerate(catchments)}
    bucket_pos = {value: index for index, value in enumerate(buckets)}

    grid = np.full((len(buckets), len(catchments)), np.nan, dtype=np.float64)
    grid[
        frame["bucket"].map(bucket_pos).to_numpy(),
        frame["catchment"].map(catchment_pos).to_numpy(),
    ] = frame["value"].to_numpy()

    breaks = _class_breaks(grid)

    # searchsorted gives the class index; +1 keeps 0 free for no-data.
    bins = np.searchsorted(np.asarray(breaks), grid, side="right").astype(np.uint8) + 1
    bins[~np.isfinite(grid)] = _NO_DATA_BIN

    return {
        "variable": selected,
        "variables": variables,
        "catchment_ids": [int(value) for value in catchments],
        "times": [pd.Timestamp(value).isoformat() for value in buckets],
        "breaks": breaks,
        "bins": base64.b64encode(bins.tobytes()).decode("ascii"),
        "step_hours": bucket_hours,
        "no_data_bin": _NO_DATA_BIN,
    }


# A chart canvas is about a thousand pixels wide, so sending one point per model timestep
# means roughly forty points per pixel. This is the default ceiling; ?max_points=0 asks for
# the full series.
_DEFAULT_MAX_POINTS = 2000


def to_epoch_seconds(time_values):
    """Parse a time column into a list of integer epoch seconds.

    Cast to datetime64[s] rather than dividing the int64 by a hardcoded 10**9. The integer
    a datetime64 casts to counts whatever unit the dtype happens to carry, and that is not
    stable across versions: pandas 2 gave datetime64[ns] here, pandas 3 -- which is what the
    image ships -- gives datetime64[us], so the same divisor produced timestamps a thousand
    times too small and every chart plotted in January 1970.
    """
    parsed = pd.to_datetime(pd.Series(list(time_values)), errors="coerce")
    seconds = parsed.astype("datetime64[s]").astype("int64")
    return [None if pd.isna(v) else int(s) for v, s in zip(parsed, seconds)]


def decimate_min_max(times, values, max_points=_DEFAULT_MAX_POINTS):
    """Thin a series to at most ``max_points``, keeping each bucket's extremes.

    Min/max per bucket rather than every nth point: dropping points at a fixed stride walks
    straight past flood peaks, which on a hydrograph is the one feature nobody wants smoothed
    away. Two points per bucket preserves the envelope the eye actually reads.

    A bucket holding only gaps emits a single null, so a gap stays a gap rather than being
    bridged by the line either side of it.
    """
    total = len(values)
    if max_points <= 0 or total <= max_points:
        return list(times), list(values), False

    buckets = max(max_points // 2, 1)
    out_times = []
    out_values = []

    for bucket in range(buckets):
        low = bucket * total // buckets
        high = (bucket + 1) * total // buckets
        if low >= high:
            continue

        lowest = highest = None
        for index in range(low, high):
            value = values[index]
            if value is None or value != value:  # None or NaN
                continue
            if lowest is None or value < values[lowest]:
                lowest = index
            if highest is None or value > values[highest]:
                highest = index

        if lowest is None:
            out_times.append(times[low])
            out_values.append(None)
            continue

        first, second = sorted((lowest, highest))
        out_times.append(times[first])
        out_values.append(values[first])
        if second != first:
            out_times.append(times[second])
            out_values.append(values[second])

    return out_times, out_values, True


def implied_time_axis(times):
    """Return {t0, dt, n} when the timestamps are evenly spaced, else None.

    Model output is written on a fixed step, so the whole time column is usually derivable
    from three numbers. Sending it as three numbers rather than tens of thousands of
    timestamps is most of the payload.
    """
    if len(times) < 2 or any(t is None for t in times):
        return None
    step = times[1] - times[0]
    if step <= 0:
        return None
    for index in range(2, len(times)):
        if times[index] - times[index - 1] != step:
            return None
    return {"t0": times[0], "dt": step, "n": len(times)}


def build_series_payload(times, values, max_points=_DEFAULT_MAX_POINTS):
    """Shape one series for the wire: columnar, and with the time axis implied when it can be."""
    times, values, decimated = decimate_min_max(times, values, max_points)
    clean = [None if v is None or v != v else float(v) for v in values]

    payload = {"v": clean, "decimated": decimated, "points": len(clean)}
    axis = None if decimated else implied_time_axis(times)
    if axis:
        payload.update(axis)
    else:
        payload["t"] = times
    return payload


def gpkg_layer_bounds_4326(gpkg_path, layers=("divides", "nexus")):
    """Return [west, south, east, north] for the first readable layer, in EPSG:4326.

    read_info reads the layer header, not its features: the extent of a 55-catchment run
    costs about 2 ms this way against reading every geometry into a GeoDataFrame to call
    total_bounds on it. The map only ever used this to frame the run.

    transform_bounds rather than transforming two corner points: it densifies the edges, so
    a box in a projected crs does not shrink when the projection curves it.
    """
    for layer in layers:
        try:
            info = pyogrio.read_info(gpkg_path, layer=layer)
        except Exception:
            continue

        bounds = info.get("total_bounds")
        if bounds is None or not len(bounds):
            continue

        crs = info.get("crs")
        if not crs:
            return [float(value) for value in bounds]
        try:
            transformer = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
            return [float(value) for value in transformer.transform_bounds(*bounds)]
        except Exception:
            logger.warning("Could not reproject %s bounds from %s", layer, crs)
            continue

    logger.info("No usable layer extent in %s", gpkg_path)
    return None


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








# Identifier and coordinate columns, not model output. `type` is excluded by dtype as well,
# but a hydrofabric that wrote it as a code rather than 'wb' would slip through that check.
_TROUTE_NON_VARIABLES = frozenset({"type", "time", "current_time", "feature_id", "featureid"})


def parse_troute_feature_id(troute_id):
    """Pull the numeric feature id out of 'cat-2863630', 'wb-2863630' or a bare '2863630'.

    Returns None when there is no digit run to find, which the callers turn into a message
    rather than the IndexError that splitting on '-' used to raise for a bare id.
    """
    match = re.search(r"\d+", str(troute_id or ""))
    return int(match.group()) if match else None


# T-Route writes CF units, which read badly in a picker. Anything not listed passes through
# verbatim rather than being guessed at.
_UNIT_LABELS = {"m3 s-1": "m\u00b3/s", "m s-1": "m/s"}

# The one T-Route output that is not a model state. Left selectable, because someone tuning
# assimilation wants it, but not silently ranked beside flow and depth.
_TROUTE_VARIABLE_NOTES = {
    "nudge": "Nudge is the data-assimilation adjustment applied to flow, not a routed state."
}


def troute_variable_note(variable):
    """Return the caveat for a T-Route variable, or None when it needs no explaining."""
    return _TROUTE_VARIABLE_NOTES.get(str(variable).lower())


def get_troute_vars(df):
    """List the troute columns worth plotting, labelled from the file's own metadata.

    Numeric dtype and an explicit name blocklist, rather than dropping the first three columns
    positionally: that only worked on a flat index, so a MultiIndexed frame offered 'type' as
    a variable and plotting it returned the string 'wb' at every timestep.

    T-Route declares long_name and units per variable, so the labels are read rather than
    invented: 'flow' becomes 'flow (m3/s)' and the bare 'nudge' becomes 'streamflow nudge
    value'. A CSV run carries no such metadata and keeps the plain column name.
    """
    meta = df.attrs.get("variable_meta", {})

    variables = []
    for name in df.columns.tolist():
        if str(name).lower() in _TROUTE_NON_VARIABLES:
            continue
        if not pd.api.types.is_numeric_dtype(df[name]):
            continue

        attrs = meta.get(str(name), {})
        label = str(attrs.get("long_name") or name).lower()
        units = attrs.get("units")
        if units:
            label = f"{label} ({_UNIT_LABELS.get(units, units)})"
        variables.append({"value": name, "label": label})

    return variables


@functools.lru_cache(maxsize=32)
def describe_troute_feature(model_run_id, feature_id):
    """Say what a T-Route feature id is, checked against the run's hydrofabric.

    T-Route indexes by flowpath, while the map selects a divide, and this hydrofabric numbers
    the two alike, so clicking cat-2863630 plots the channel wb-2863630. That is a convention
    of the fabric rather than a guarantee, so the pairing is read out of the gpkg instead of
    assumed. Returns (flowpath_id, divide_id), either of which may be None.
    """
    gpkg_path = find_gpkg_file_path(model_run_id)
    if not gpkg_path:
        return None, None

    flowpath_id = f"wb-{feature_id}"
    try:
        with sqlite3.connect(f"file:{gpkg_path}?mode=ro", uri=True) as connection:
            row = connection.execute(
                "SELECT id, divide_id FROM flowpaths WHERE id = ?", (flowpath_id,)
            ).fetchone()
    except sqlite3.Error:
        logger.warning("Could not read flowpaths from %s", gpkg_path)
        return None, None

    return (row[0], row[1]) if row else (None, None)


def check_troute_id(df, id):
    if isinstance(df.index, pd.MultiIndex):
        # Multi-indexed DataFrame: Check in the `feature_id` level
        return int(id) in df.index.get_level_values("feature_id")
    else:
        # Flat-indexed DataFrame: Check in the `featureID` column
        return int(id) in df["featureID"].values

