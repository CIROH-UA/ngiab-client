import os
import re
import math
import functools
import posixpath
from typing import NamedTuple
import base64
import logging
import numpy as np
import pandas as pd
import xarray as xr


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

    entry = _run_entry(model_run_id)
    document = (entry or {}).get("manifest") or {}
    present = (document.get("teehr") or {}).get("present")
    dataset = evaluation_dir(entry["path"] if entry else None, present=present)
    if dataset:
        return (lambda: EvaluationReader(dataset)), RUN_CONFIGURATION

    if not _teehr_warehouse_path():
        return None, None

    config_name = _resolve_configuration_name(model_run_id)
    if config_name is None:
        return None, None

    return _open_warehouse, config_name


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
        "path": entry["path"],
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

    ``rescannable`` is gone. It told the removal confirmation whether the importer could
    offer a run again, which mattered while a run could be registered from outside the
    managed root. There is no importer and no outside now -- a run is a directory under the
    storage root -- so the question has no answer to give.
    """
    return [
        {"value": model_run["id"], "label": model_run["label"]}
        for model_run in _get_list_model_runs()["model_runs"]
    ]

# The importer is gone. scan_roots, is_scannable, describe_importable_run,
# scan_importable_runs, _has_catchment_output and MANAGED_ROOT went with it: a run is a
# directory under the storage root now, so being present and being registered are the same
# thing and there is nothing left to offer or refuse. run_store.list_runs still reports a
# directory it cannot use, with the reason, which is the part of describe_importable_run
# worth keeping -- a directory a user can see and the interface cannot is a bug either way.


class UnknownModelRun(Exception):
    """Raised when a request names a model run that is not registered.

    Kept separate from _get_model_run_path_by_id, which returns None on purpose: a caller
    asking "is this run known" wants an answer, not a failure.
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


def _run_entry(model_run_id):
    """The storage entry for a run id: its name, its location, and its manifest.

    One lookup for everything the read path needs, so a request resolves the run once
    instead of re-deriving facts from the filesystem each time it wants one. Accepts a
    directory name or any id the run previously answered to.
    """
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


def _child(base, *parts):
    """Join below a run's location, whether that is a path or an ``s3://`` URI.

    posixpath rather than os.path because the separator has to stay ``/`` for a URI, and this
    only ever runs on Linux where the two agree for filesystem paths anyway.
    """
    return posixpath.join(base, *[str(part).strip("/") for part in parts if part])


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

def run_bounds_4326(model_run_id):
    """The extent to frame the map on, distilled at ingest.

    Was pyogrio.read_info over a GeoPackage found by walking config/. A GeoPackage is SQLite
    and cannot be read from an object store at all, which is why this is four numbers in a
    manifest rather than a smaller read.
    """
    return _run_manifest(model_run_id).get("bounds")







# Stands in for NaN between reading the file and serialising the response.
TROUTE_MISSING = -9999


_TROUTE_SUBDIR = os.path.join("outputs", "troute")

TROUTE_FEATURE_COLUMN = "feature_id"
TROUTE_TIME_COLUMN = "time"

# Identifier and coordinate columns across every troute source shape, so the picker never
# offers one as something to plot.
_TROUTE_NON_VARIABLES = frozenset(
    {"type", "time", "current_time", "feature_id", "featureid"}
)


@functools.lru_cache(maxsize=8)
def _cached_troute_frame(directory, version, source, source_format):
    """One read per run, not one per request.

    getTrouteVariables and getTrouteTimeSeries are separate requests and each used to read
    the whole file -- ``xr.open_dataset(...).to_dataframe()`` loads every feature and every
    timestep to plot one channel. Converting to parquet makes that read cheaper; only caching
    makes it stop happening twice per chart. Keyed on the version token, like every other
    cache here, because an object-store prefix has no mtime.
    """
    return _normalised_troute_frame(source, source_format)


def _normalised_troute_frame(source, source_format):
    """One shape, whatever the run wrote.

    T-route appears in three forms -- a converted parquet, a NetCDF whose ``to_dataframe()``
    yields a MultiIndex keyed on feature_id, and a flat csv with a ``featureID`` column and a
    ``current_time`` -- and the readers used to branch on which. That branching is what breaks
    silently under conversion: parquet has no MultiIndex and its column is ``feature_id``, so
    a converted run missed the MultiIndex branch and then missed ``featureID`` too, and every
    chart came back empty with no error anywhere.

    Normalising here instead means the endpoint has one path and conversion is an
    optimisation rather than a change of shape. The pinned columns are ``feature_id`` and
    ``time``, with the time already formatted the way the response emits it.
    """
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

    # A bare NaN is invalid JSON, so gaps travel as a sentinel and come back null.
    return frame.fillna(TROUTE_MISSING)


def _troute_time_string(value):
    """The response emits '%Y-%m-%d %H:%M:%S' whatever the source stored."""
    if isinstance(value, pd.Timestamp):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


#: Formats the t-route reader can open from wherever the run lives.
#:
#: netCDF is read with xarray, which takes a filesystem path -- it cannot open an ``s3://``
#: URI at all. An unconverted run published to a bucket therefore serves its catchment data
#: (DuckDB globs csv over s3 happily) and then raised inside xarray on every routing chart.
#: Conversion is the hosted workflow, so the honest answer is "no routing output here" plus
#: a log line naming the fix, rather than a traceback the user cannot act on.
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


# Where ngen writes by default, and what the converter and the importer both assume.
_DEFAULT_OUTPUT_SUBDIR = "ngen"


def get_base_output(model_id):
    """Where this run's catchment outputs live.

    From the manifest. This used to read config/realization.json on every catchment request
    -- the highest-frequency file open in the app -- to find ``output_root``.
    """
    entry = _require_run_entry(model_id)
    document = entry["manifest"] or {}
    return _child(
        entry["path"],
        manifest.contained_output_dir(document.get("output_dir")),
    )

# Output files may be csv (as ngen writes them) or parquet (as viewOnTethys.sh rewrites
# them at import). Parquet first: when both exist it is the cheaper read.
_OUTPUT_SUFFIXES = (".parquet", ".csv")

# Columns no catchment wrote. ``filename`` is synthesised by DuckDB's filename=true;
# ``catchment_id`` is written by the consolidator. Offering either as a plottable variable
# would put a file path or an id in the chart's variable picker.
_SYNTHETIC_COLUMNS = ("filename", "catchment_id")


def _find_output_file(directory, stem, suffix, known):
    """(location, suffix) for one catchment's output, or raise.

    Existence comes from the manifest's catchment list rather than ``os.path.exists``. The
    FileNotFoundError is preserved deliberately: it is what getCatchmentTimeSeries turns into
    "This run has no output for <id>", and answering an unknown catchment with an empty chart
    instead would be worse than the 404.
    """
    if not suffix or stem not in known:
        raise FileNotFoundError(f"No output file for {stem!r} in {directory}")
    return _child(directory, f"{stem}{suffix}"), suffix


def _read_output_columns(outputs, stem):
    """List an output file's column names without reading its rows.

    For parquet this is answered from the footer (LIMIT 0 reads no row groups), which is
    what lets the caller then ask for just the two columns it needs.
    """
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
    if stem not in outputs.catchments:
        raise FileNotFoundError(f"No output for {stem!r} in {outputs.directory}")

    if outputs.groups:
        return _read_from_group(outputs, stem, columns, time_column)

    path, suffix = _find_output_file(
        outputs.directory, stem, outputs.suffix, outputs.catchments
    )

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
                parts.append(duckdb_conn.quote_identifier(column))
        return duckdb_conn.query(
            f"SELECT {', '.join(parts)} FROM read_parquet({duckdb_conn.quote(path)})"
        )

    # Same VARCHAR cast as the parquet branch, and for the same measured reason.
    parts = []
    for column in columns or ["*"]:
        if column == "*":
            parts.append("*")
        elif time_column and column == time_column:
            parts.append(f'CAST("{column}" AS VARCHAR) AS "{column}"')
        else:
            parts.append(duckdb_conn.quote_identifier(column))
    return duckdb_conn.query(
        f"SELECT {', '.join(parts)} FROM read_csv_auto({duckdb_conn.quote(path)})"
    )


# Frames the map animation may hold, and cells the response may carry. Both are ceilings on
# the payload, not on the data: exceeding either coarsens the time step, it never truncates.
_MAX_FRAMES = 2000
_MAX_CELLS = 4_000_000

# Coarsening ladder in hours, ending at roughly a month.
_BUCKET_HOURS = (1, 3, 6, 12, 24, 48, 168, 720)

# Bin 0 is reserved for no-data, so a missing value never renders as the lowest class.
_NO_DATA_BIN = 0
_CLASS_COUNT = 8


def _group_table_for(outputs, stem):
    """A table expression over the one consolidated group holding this catchment.

    One group, not a union across all of them. Scanning every group with ``union_by_name``
    would pad a catchment from a narrower schema with NULL columns it never wrote, and then
    report them as variables it has -- which is precisely what grouping by schema avoided.
    The group index comes from the manifest, so this costs a cached lookup rather than a
    probe per group per request.
    """
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
    """One catchment's series out of a consolidated group.

    Columns absent from that catchment's own group read back as NULL under union_by_name, so
    they are dropped: a catchment must report the variables it wrote, not the run's union.
    That is what the per-catchment layout gave for free and what consolidation has to
    reproduce deliberately.
    """
    table = _group_table_for(outputs, stem)
    available = set(duckdb_conn.query(f"SELECT * FROM {table} LIMIT 0").columns)

    parts = []
    for column in columns or ["*"]:
        if column == "*":
            parts.append("*")
        elif column not in available:
            continue
        elif time_column and column == time_column:
            parts.append(f'CAST("{column}" AS VARCHAR) AS "{column}"')
        else:
            parts.append(duckdb_conn.quote_identifier(column))

    return duckdb_conn.query(f"SELECT {', '.join(parts)} FROM {table}")


def _output_table(outputs, prefix="cat-"):
    """A DuckDB table expression reading every catchment output at once.

    Two layouts, because a run on disk may be in either. Consolidated files carry their own
    ``catchment_id`` column and are read by name from the manifest; per-catchment files are
    globbed with ``filename=true`` and the id recovered from the path, which is what the
    original layout required.

    Either way the pattern comes from the manifest rather than a directory glob, which is a
    filesystem call with no object-store equivalent. DuckDB expands the glob itself, over
    either backend.
    """
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
    """Column names across every file in the glob, not just the first.

    union_by_name means a run whose catchments were produced by different formulations still
    reports the full set. LIMIT 0 answers this from parquet footers without reading rows.

    'filename' is dropped: it is synthesised by filename=true, not something the run wrote,
    and leaving it in offers it to the user as a plottable variable.
    """
    columns = list(duckdb_conn.query(f"SELECT * FROM {table} LIMIT 0").columns)
    return [name for name in columns if name not in _SYNTHETIC_COLUMNS]


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
def _cached_catchment_variables(directory, version, table):
    """Keyed on the run's version token so re-ingested outputs invalidate it.

    The table expression is part of the key rather than an argument to rebuild, because it
    already encodes the layout and the format -- two runs differing in either cannot collide.
    """
    if table is None:
        return None
    return tuple(_union_columns(table))


class RunOutputs(NamedTuple):
    """Everything the catchment readers used to learn by probing the directory.

    Resolved once per request from the manifest, then passed down. Before this the readers
    each rediscovered the same three facts -- which format is present, which catchments
    exist, and whether anything changed -- with a glob, a listdir and an os.stat, none of
    which an object store answers.
    """

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
    """The run's content-derived cache key.

    Replaces ``_output_fingerprint``, which was ``os.stat(directory).st_mtime_ns``. An object
    store prefix has no mtime, so that call returns None there -- leaving the key constant
    and a re-ingested run serving stale bins forever.
    """
    return _run_manifest(model_run_id).get("version_token", "")


def get_catchment_variables(model_run_id):
    """Variables this run actually wrote, in the order the output files declare them.

    Cached because the answer costs a schema read of every catchment file. Parquet answers
    from footers, but a run still in csv has to be sniffed file by file: measured on an
    8105-catchment run, 53.9 s as csv against 0.26 s once converted. Paying that on every
    page load left the shading control disabled for most of a minute.
    """
    outputs = run_outputs(model_run_id)
    table, _ = _output_table(outputs)
    columns = _cached_catchment_variables(outputs.directory, outputs.version, table)
    if columns is None:
        return {"variables": [], "time_column": None}
    if len(columns) < 3:
        return {"variables": [], "time_column": None}

    # Same positional contract as getCatchmentTimeSeries: 0 is the step, 1 is the timestamp.
    return {"variables": list(columns[2:]), "time_column": columns[1]}


@functools.lru_cache(maxsize=8)
def _cached_value_matrix(directory, variable, version, table, consolidated, catchment_count):
    """Keyed on the version token: a re-ingested run must not serve the previous grid."""
    return _build_value_matrix(table, variable, consolidated, catchment_count)


def get_catchment_value_matrix(model_run_id, variable=None):
    """Per-catchment values over time for one variable, quantised for a choropleth.

    Cached because scrubbing the timeline must not re-scan the outputs, and a full read costs
    seconds on csv. The version token makes a converted or re-ingested run miss the cache.

    The cached dict is handed straight to JsonResponse and must not be mutated by callers.
    """
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
    """Everything here is derived from the run being asked about.

    Runs differ in which variables they wrote, over what period, at what step, and across what
    range of values, so none of those may be assumed or shared between runs.
    """
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

    span_hours = max((end - start).total_seconds() / 3600.0, 0.0)
    bucket_hours = _choose_bucket_hours(distinct_times, span_hours, catchment_count)

    bucket_expr = (
        time_expr
        if bucket_hours is None
        else f"time_bucket(INTERVAL '{bucket_hours} hours', {time_expr})"
    )

    # Consolidated rows carry the id; per-catchment rows do not, so it comes from the path.
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


def getCatchmentsIds(model_run_id):
    """The catchment picker's options."""
    return [{"value": cid, "label": cid} for cid in getCatchmentsList(model_run_id)]


def getCatchmentsList(model_id):
    """The run's catchment ids, from the manifest sidecar rather than a directory listing."""
    entry = _require_run_entry(model_id)
    document = entry.get("manifest") or {}
    return manifest.catchments(entry["path"], document.get("version_token", ""))








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


def describe_troute_feature(model_run_id, feature_id):
    """Say what a T-Route feature id is, checked against the run's hydrofabric.

    T-Route indexes by flowpath, while the map selects a divide, and this hydrofabric numbers
    the two alike, so clicking cat-2863630 plots the channel wb-2863630. That is a convention
    of the fabric rather than a guarantee, so the pairing is still read rather than assumed --
    from the crosswalk distilled at ingest, instead of from the GeoPackage as SQLite.

    No longer lru_cached per feature. The crosswalk is cached whole, keyed on the run's
    version token, because looking one pairing up at a time is what made the old
    ``lru_cache(32)`` necessary and is exactly the cost that does not survive object storage.

    Returns (flowpath_id, divide_id), either of which may be None.
    """
    entry = _run_entry(model_run_id)
    if entry is None:
        return None, None

    flowpath_id = f"wb-{feature_id}"
    document = entry.get("manifest") or {}
    divide_id = manifest.crosswalk(
        entry["path"], document.get("version_token", "")
    ).get(flowpath_id)
    return (flowpath_id, divide_id) if divide_id is not None else (None, None)


def check_troute_id(df, id):
    """Whether this run routed the given feature.

    One branch now: every source shape is normalised to a ``feature_id`` column before it
    reaches here.
    """
    if df is None or TROUTE_FEATURE_COLUMN not in df.columns:
        return False
    return int(id) in set(df[TROUTE_FEATURE_COLUMN].dropna().astype("int64").tolist())

