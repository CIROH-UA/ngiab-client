import os
import re
import math
import functools
from typing import NamedTuple
import base64
import logging
import numpy as np
import pandas as pd
import xarray as xr


from . import duckdb_conn, manifest, run_store
from .manifest import child as _child

logger = logging.getLogger(__name__)


def teehr_source(model_run_id):
    """A reader for this run's own TEEHR evaluation, or None when it has none."""
    from .teehr_evaluation import RUN_CONFIGURATION, EvaluationReader, evaluation_dir

    entry = _run_entry(model_run_id)
    document = (entry or {}).get("manifest") or {}
    present = (document.get("teehr") or {}).get("present")
    dataset = evaluation_dir(entry["path"] if entry else None, present=present)
    if not dataset:
        return None, None
    return (lambda: EvaluationReader(dataset)), RUN_CONFIGURATION

def _entry_from_manifest(entry):
    """One run_store entry, in the dict shape every reader here already expects."""
    document = entry["manifest"] or {}
    created = document.get("created") or ""
    return {
        "label": document.get("label") or entry["name"],
        "path": entry["path"],
        "date": created.replace("T", ":")[:19] if created else "",
        "id": document.get("id") or entry["name"],
        "legacy_uuids": document.get("legacy_uuids") or [],
        "teehr_configuration_name": (document.get("teehr") or {}).get(
            "configuration_name", ""
        ),
    }


def _get_list_model_runs():
    """Return the registered, usable model runs in the shape callers already expect."""
    return {
        "model_runs": [
            _entry_from_manifest(entry) for entry in run_store.list_runs() if entry["usable"]
        ]
    }


def get_model_runs_selectable():
    """The run picker's options."""
    return [
        {"value": model_run["id"], "label": model_run["label"]}
        for model_run in _get_list_model_runs()["model_runs"]
    ]


class UnknownModelRun(Exception):
    """Raised when a request names a model run that is not registered."""


def model_run_exists(model_run_id):
    """Whether a run id is registered. False for None, so a missing parameter is not a match."""
    return model_run_id is not None and _get_model_run_path_by_id(model_run_id) is not None


def _run_entry(model_run_id):
    """The storage entry for a run id: its name, its location, and its manifest."""
    if model_run_id is None:
        return None

    wanted = manifest.normalize_uuid(model_run_id)
    for entry in run_store.list_runs():
        document = entry.get("manifest") or {}
        if document.get("id") == model_run_id or entry["name"] == model_run_id:
            return entry
        if wanted and wanted in (document.get("legacy_uuids") or []):
            return entry
    return None


def _require_run_entry(model_run_id):
    entry = _run_entry(model_run_id)
    if entry is None:
        raise UnknownModelRun(model_run_id)
    return entry


def _run_manifest(model_run_id):
    """The distilled facts for a run. Every probe the read path used to make is in here."""
    return _require_run_entry(model_run_id)["manifest"] or {}


def _get_model_run_path_by_id(id):
    """Resolve a run id to its location, accepting the ids it answered to before."""
    if id is None:
        return None

    wanted = manifest.normalize_uuid(id)
    for model_run in _get_list_model_runs()["model_runs"]:
        if model_run["id"] == id:
            return model_run["path"]
        if wanted and wanted in model_run.get("legacy_uuids", []):
            return model_run["path"]
    return None

def run_bounds_4326(model_run_id):
    """The extent to frame the map on, distilled at ingest."""
    return _run_manifest(model_run_id).get("bounds")


TROUTE_MISSING = -9999


_TROUTE_SUBDIR = os.path.join("outputs", "troute")

TROUTE_FEATURE_COLUMN = "feature_id"
TROUTE_TIME_COLUMN = "time"

_TROUTE_NON_VARIABLES = frozenset(
    {"type", "time", "current_time", "feature_id", "featureid"}
)


@functools.lru_cache(maxsize=32)
def _cached_troute_frame(directory, version, source, source_format):
    """One read per run, not one per request; cached and keyed on the version token."""
    return _normalised_troute_frame(source, source_format)


def _normalised_troute_frame(source, source_format):
    """Read a t-route output file (parquet, csv, or NetCDF) into one normalised frame."""
    if source_format == ".parquet":
        frame = duckdb_conn.query(
            f"SELECT * FROM read_parquet({duckdb_conn.quote(source)})"
        )
    elif source_format == ".csv":
        frame = duckdb_conn.query(
            f"SELECT * FROM read_csv_auto({duckdb_conn.quote(source)})"
        )
        frame = frame.rename(
            columns={"featureID": TROUTE_FEATURE_COLUMN, "current_time": TROUTE_TIME_COLUMN}
        )
    else:
        dataset = xr.open_dataset(source)
        try:
            frame = dataset.to_dataframe().reset_index()
        finally:
            dataset.close()

    if TROUTE_TIME_COLUMN in frame.columns:
        frame[TROUTE_TIME_COLUMN] = frame[TROUTE_TIME_COLUMN].apply(_troute_time_string)
    if TROUTE_FEATURE_COLUMN in frame.columns:
        frame[TROUTE_FEATURE_COLUMN] = pd.to_numeric(
            frame[TROUTE_FEATURE_COLUMN], errors="coerce"
        ).astype("Int64")

    return frame.fillna(TROUTE_MISSING)


def _troute_time_string(value):
    """The response emits '%Y-%m-%d %H:%M:%S' whatever the source stored."""
    if isinstance(value, pd.Timestamp):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


_TROUTE_OBJECT_STORAGE_FORMATS = (".parquet",)


def troute_readable_here(fmt):
    """Whether t-route in ``fmt`` can be read against the configured backend."""
    if not duckdb_conn.is_object_storage():
        return True
    return (fmt or "").lower() in _TROUTE_OBJECT_STORAGE_FORMATS


def get_troute_df(model_id):
    """This run's t-route output, in the pinned shape, read once and cached."""
    entry = _run_entry(model_id)
    if entry is None:
        return None

    document = entry["manifest"] or {}
    troute = document.get("troute")
    if not troute:
        return None
    if not troute_readable_here(troute.get("format", "")):
        logger.warning(
            "Run %s has %s t-route output, which cannot be read from object storage; "
            "re-convert the run so it is published as parquet",
            model_id, troute.get("format") or "unknown",
        )
        return None

    frame = _cached_troute_frame(
        _child(entry["path"], _TROUTE_SUBDIR),
        document.get("version_token", ""),
        _child(entry["path"], troute["file"]),
        troute.get("format", ""),
    )
    frame = frame.copy()
    frame.attrs["variable_meta"] = troute.get("variables") or {}
    return frame


def get_base_output(model_id):
    """Where this run's catchment outputs live."""
    return run_outputs(model_id).directory


_OUTPUT_SUFFIXES = (".parquet", ".csv")

_SYNTHETIC_COLUMNS = ("filename", "catchment_id")


def _find_output_file(directory, stem, suffix, known):
    """(location, suffix) for one catchment's output, or raise FileNotFoundError."""
    if not suffix or stem not in known:
        raise FileNotFoundError(f"No output file for {stem!r} in {directory}")
    return _child(directory, f"{stem}{suffix}"), suffix


def _read_output_columns(outputs, stem):
    """List an output file's column names without reading its rows."""
    if stem not in outputs.catchments:
        raise FileNotFoundError(f"No output for {stem!r} in {outputs.directory}")

    if outputs.groups:
        table = _group_table_for(outputs, stem)
        columns = list(duckdb_conn.query(f"SELECT * FROM {table} LIMIT 0").columns)
        return [name for name in columns if name not in _SYNTHETIC_COLUMNS]

    path, suffix = _find_output_file(
        outputs.directory, stem, outputs.suffix, outputs.catchments
    )
    reader = "read_parquet" if suffix == ".parquet" else "read_csv_auto"
    return list(duckdb_conn.query(
        f"SELECT * FROM {reader}({duckdb_conn.quote(path)}) LIMIT 0"
    ).columns)


def _read_output_frame(outputs, stem, columns=None, time_column=None):
    """Read one output file as a DataFrame with column projection, preferring parquet."""
    if stem not in outputs.catchments:
        raise FileNotFoundError(f"No output for {stem!r} in {outputs.directory}")

    if outputs.groups:
        return _read_from_group(outputs, stem, columns, time_column)

    path, suffix = _find_output_file(
        outputs.directory, stem, outputs.suffix, outputs.catchments
    )
    reader = "read_parquet" if suffix == ".parquet" else "read_csv_auto"
    return duckdb_conn.query(
        f"SELECT {_projection(columns, time_column)} "
        f"FROM {reader}({duckdb_conn.quote(path)})"
    )


def _projection(columns, time_column, available=None):
    """The SELECT list for one output read: quoted names, with the time column cast."""
    parts = []
    for column in columns or ["*"]:
        if column == "*":
            parts.append("*")
        elif available is not None and column not in available:
            continue
        elif time_column and column == time_column:
            parts.append(f'CAST("{column}" AS VARCHAR) AS "{column}"')
        else:
            parts.append(duckdb_conn.quote_identifier(column))
    return ", ".join(parts)


_MAX_FRAMES = 2000
_MAX_CELLS = 4_000_000

_BUCKET_HOURS = (1, 3, 6, 12, 24, 48, 168, 720)

_NO_DATA_BIN = 0
_CLASS_COUNT = 8
_NORM_PERCENTILE_CLAMP = (2, 98)


def _group_table_for(outputs, stem):
    """A table expression over the one consolidated group holding this catchment."""
    index = manifest.catchment_group(outputs.run_path, stem, outputs.version)
    if index is None:
        raise FileNotFoundError(f"No output for {stem!r} in {outputs.directory}")

    name = (
        outputs.groups[index]
        if index < len(outputs.groups)
        else f"{manifest.CONSOLIDATED_PREFIX}{index}.parquet"
    )
    path = _child(outputs.directory, name)
    return (
        f"(SELECT * FROM read_parquet({duckdb_conn.quote(path)}) "
        f"WHERE catchment_id = {duckdb_conn.quote(stem)})"
    )


def _read_from_group(outputs, stem, columns, time_column):
    """One catchment's series out of a consolidated group."""
    table = _group_table_for(outputs, stem)
    available = set(duckdb_conn.query(f"SELECT * FROM {table} LIMIT 0").columns)
    return duckdb_conn.query(
        f"SELECT {_projection(columns, time_column, available)} FROM {table}"
    )


def _output_table(outputs, prefix="cat-"):
    """A DuckDB table expression reading every catchment output at once."""
    if outputs.groups:
        pattern = _child(outputs.directory, f"{manifest.CONSOLIDATED_PREFIX}*.parquet")
        return f"read_parquet({duckdb_conn.quote(pattern)}, union_by_name=true)", ".parquet"

    if not outputs.suffix:
        return None, None
    pattern = _child(outputs.directory, f"{prefix}*{outputs.suffix}")
    reader = "read_parquet" if outputs.suffix == ".parquet" else "read_csv"
    table = f"{reader}({duckdb_conn.quote(pattern)}, filename=true, union_by_name=true)"
    return table, outputs.suffix


def _union_columns(table):
    """Column names across every file in the glob, not just the first."""
    columns = list(duckdb_conn.query(f"SELECT * FROM {table} LIMIT 0").columns)
    return [name for name in columns if name not in _SYNTHETIC_COLUMNS]


def _choose_bucket_hours(distinct_times, span_hours, catchment_count):
    """Pick the finest bucket step that keeps the response under both ceilings, or None."""
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
    """Quantile breaks over the run's own distribution, deduplicated."""
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return []

    quantiles = np.linspace(0, 1, _CLASS_COUNT + 1)[1:-1]
    breaks = np.quantile(finite, quantiles)
    lowest = float(finite.min())

    unique = []
    for value in breaks:
        value = float(value)
        if value <= lowest:
            continue
        if not unique or value > unique[-1]:
            unique.append(value)
    return unique


def _value_norms(grid):
    """Per-cell magnitude scaled to 0-255, clamped to the run's 2nd-98th percentile.

    Drives extrusion height so prisms reflect the actual value, not just the
    quantile rank. The percentile clamp keeps a single outlier catchment from
    flattening everyone else. No-data and no-spread cells resolve to 0.
    """
    norms = np.zeros(grid.shape, dtype=np.uint8)
    finite = np.isfinite(grid)
    if not finite.any():
        return norms
    low, high = np.nanpercentile(grid, _NORM_PERCENTILE_CLAMP)
    span = float(high) - float(low)
    if span > 0:
        scaled = np.clip((grid - float(low)) / span, 0.0, 1.0)
        scaled[~finite] = 0.0
        norms = (scaled * 255.0).astype(np.uint8)
    return norms


@functools.lru_cache(maxsize=32)
def _cached_catchment_variables(directory, version, table):
    """Keyed on the run's version token so re-ingested outputs invalidate it."""
    if table is None:
        return None
    return tuple(_union_columns(table))


class RunOutputs(NamedTuple):
    """Everything the catchment readers need, resolved once per request from the manifest."""

    directory: str
    suffix: str
    catchments: tuple
    version: str
    groups: tuple
    run_path: str


def run_outputs(model_run_id):
    """The output context for a run."""
    entry = _require_run_entry(model_run_id)
    document = entry["manifest"] or {}
    directory = _child(
        entry["path"],
        manifest.contained_output_dir(document.get("output_dir")),
    )
    return RunOutputs(
        directory=directory,
        suffix=document.get("output_format") or "",
        catchments=tuple(
            manifest.catchments(entry["path"], document.get("version_token", ""))
        ),
        version=document.get("version_token", ""),
        groups=tuple(document.get("output_groups") or ()),
        run_path=entry["path"],
    )


def _version_of(model_run_id):
    """The run's content-derived cache key."""
    return _run_manifest(model_run_id).get("version_token", "")


def get_catchment_variables(model_run_id):
    """Variables this run actually wrote, in the order the output files declare them."""
    outputs = run_outputs(model_run_id)
    table, _ = _output_table(outputs)
    columns = _cached_catchment_variables(outputs.directory, outputs.version, table)
    if columns is None or len(columns) < 3:
        return {"variables": [], "time_column": None}

    return {"variables": list(columns[2:]), "time_column": columns[1]}


@functools.lru_cache(maxsize=32)
def _cached_value_matrix(directory, variable, version, table, consolidated, catchment_count):
    """Keyed on the version token: a re-ingested run must not serve the previous grid."""
    return _build_value_matrix(table, variable, consolidated, catchment_count)


def get_catchment_value_matrix(model_run_id, variable=None):
    """Per-catchment values over time for one variable, quantised for a choropleth."""
    outputs = run_outputs(model_run_id)
    table, _ = _output_table(outputs)
    return _cached_value_matrix(
        outputs.directory,
        variable,
        outputs.version,
        table,
        bool(outputs.groups),
        len(outputs.catchments),
    )


def _build_value_matrix(table, variable=None, consolidated=False, catchment_count=0):
    """Build the choropleth value matrix for one variable, derived from the run."""
    empty = {
        "variable": None,
        "variables": [],
        "catchment_ids": [],
        "times": [],
        "breaks": [],
        "bins": "",
        "norms": "",
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

    span_hours = max((end - start).total_seconds() / 3600.0, 0.0)
    bucket_hours = _choose_bucket_hours(distinct_times, span_hours, catchment_count)

    bucket_expr = (
        time_expr
        if bucket_hours is None
        else f"time_bucket(INTERVAL '{bucket_hours} hours', {time_expr})"
    )

    id_source = "catchment_id" if consolidated else "filename"
    id_expr = f"regexp_extract({id_source}, 'cat-(\\d+)', 1)"
    frame = duckdb_conn.query(
        f"""
        SELECT
            CAST({id_expr} AS BIGINT) AS catchment,
            {bucket_expr} AS bucket,
            avg("{selected}") AS value
        FROM {table}
        WHERE {id_expr} <> ''
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

    bins = np.searchsorted(np.asarray(breaks), grid, side="right").astype(np.uint8) + 1
    bins[~np.isfinite(grid)] = _NO_DATA_BIN

    norms = _value_norms(grid)

    return {
        "variable": selected,
        "variables": variables,
        "catchment_ids": [int(value) for value in catchments],
        "times": [pd.Timestamp(value).isoformat() for value in buckets],
        "breaks": breaks,
        "bins": base64.b64encode(bins.tobytes()).decode("ascii"),
        "norms": base64.b64encode(norms.tobytes()).decode("ascii"),
        "step_hours": bucket_hours,
        "no_data_bin": _NO_DATA_BIN,
    }


_DEFAULT_MAX_POINTS = 2000


def to_epoch_seconds(time_values):
    """Parse a time column into a list of integer epoch seconds."""
    parsed = pd.to_datetime(pd.Series(list(time_values)), errors="coerce")
    seconds = parsed.astype("datetime64[s]").astype("int64")
    return [None if pd.isna(v) else int(s) for v, s in zip(parsed, seconds)]


def decimate_min_max(times, values, max_points=_DEFAULT_MAX_POINTS):
    """Thin a series to at most ``max_points``, keeping each bucket's extremes."""
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
            if value is None or value != value:
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
    """Return {t0, dt, n} when the timestamps are evenly spaced, else None."""
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


def getCatchmentsIds(model_run_id):
    """The catchment picker's options."""
    return [{"value": cid, "label": cid} for cid in getCatchmentsList(model_run_id)]


def getCatchmentsList(model_id):
    """The run's catchment ids, from the manifest sidecar rather than a directory listing."""
    entry = _require_run_entry(model_id)
    document = entry.get("manifest") or {}
    return manifest.catchments(entry["path"], document.get("version_token", ""))


def parse_troute_feature_id(troute_id):
    """Pull the numeric feature id out of 'cat-2863630', 'wb-2863630' or a bare '2863630'."""
    match = re.search(r"\d+", str(troute_id or ""))
    return int(match.group()) if match else None


_UNIT_LABELS = {"m3 s-1": "m\u00b3/s", "m s-1": "m/s"}

_TROUTE_VARIABLE_NOTES = {
    "nudge": "Nudge is the data-assimilation adjustment applied to flow, not a routed state."
}


def troute_variable_note(variable):
    """Return the caveat for a T-Route variable, or None when it needs no explaining."""
    return _TROUTE_VARIABLE_NOTES.get(str(variable).lower())


def get_troute_vars(df):
    """List the troute columns worth plotting, labelled from the file's own metadata."""
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


def describe_troute_feature(model_run_id, feature_id):
    """Say what a T-Route feature id is, checked against the run's hydrofabric."""
    entry = _run_entry(model_run_id)
    if entry is None:
        return None, None

    flowpath_id = f"wb-{feature_id}"
    document = entry.get("manifest") or {}
    divide_id = manifest.divide_for(
        entry["path"], flowpath_id, document.get("version_token", "")
    )
    return (flowpath_id, divide_id) if divide_id is not None else (None, None)


def check_troute_id(df, id):
    """Whether this run routed the given feature."""
    if df is None or TROUTE_FEATURE_COLUMN not in df.columns:
        return False
    return int(id) in set(df[TROUTE_FEATURE_COLUMN].dropna().astype("int64").tolist())

