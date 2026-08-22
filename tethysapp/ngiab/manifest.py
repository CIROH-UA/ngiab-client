"""What ingest distills from a run so the read path never probes the filesystem.

Every fact here replaces a probe that works on a local disk and does not work, or does not
exist, on an object store: ``os.stat`` for a cache key, ``open()`` on realization.json,
``os.walk`` for the GeoPackage, ``os.listdir`` for the catchment list, ``os.path.isdir`` for
the TEEHR evaluation. The manifest is not a new source of truth -- it is the same truth,
computed once while the run is unpacked and reachable, and stored beside the data it
describes.

**Hot document, cold sidecars.** ``manifest.json`` holds only what the run picker needs, and
the picker is reached on essentially every request through ``_get_list_model_runs()``, which
reads *every* registered run's manifest. The catchment list and the flowpath crosswalk both
scale with run size -- tens of thousands of entries is ordinary -- so embedding them would
put megabytes of JSON parsing on that path. They go in sidecars, loaded only by the endpoints
that need them, and loaded whole: ``describe_troute_feature`` looks up an arbitrary feature
id, so a per-feature read over object storage would simply move the per-feature cost from
SQLite to S3.

**The manifest is per-run, not a registry.** It lives inside the run directory, so a run is
self-describing and portable, backup is ``cp -r``, and there is no row that can point at a
prefix that no longer exists.
"""

import functools
import hashlib
import json
import logging
import os
import re
import sqlite3

from . import duckdb_conn

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1

MANIFEST_NAME = "manifest.json"
CATCHMENTS_SIDECAR = "manifest_catchments.json"
CROSSWALK_SIDECAR = "manifest_crosswalk.parquet"

# Mirrors utils._OUTPUT_SUFFIXES: parquet first, because the reader prefers it when both are
# present and the manifest has to record the one that will actually be read.
_OUTPUT_SUFFIXES = (".parquet", ".csv")

_DEFAULT_OUTPUT_SUBDIR = os.path.join("outputs", "ngen")
_TROUTE_SUBDIR = os.path.join("outputs", "troute")

_UUID_CHARS = re.compile(r"[0-9a-f]{32}\Z")


def normalize_uuid(value):
    """Reduce either UUID spelling to the 32-character undashed form Django stores.

    Django writes a UUIDField to SQLite as 32 hex characters with no dashes and builds its
    lookups the same way. A row inserted by anything else -- a hand-edited database, a raw
    INSERT, an import script -- can hold the 36-character dashed form instead, read back
    correctly, appear in the picker, and never match ``filter(id=...)``. That is what
    ``migrations/0002_normalize_model_run_ids`` had to repair, and resolving a run by
    manifest must not reimport it.

    Returns the input lowercased and stripped of dashes when it looks like a UUID, and
    unchanged otherwise -- a directory name is a legitimate run id too.
    """
    candidate = str(value or "").strip().lower().replace("-", "")
    return candidate if _UUID_CHARS.match(candidate) else str(value or "").strip()


def _read_realization_output_dir(run_path):
    """The run-relative output directory, from realization.json's ``output_root``.

    Mirrors utils.resolve_output_dir, including its fallback: a run without the file, or
    with one that does not declare the key, uses ``outputs/ngen`` rather than raising. Such
    runs exist, and treating them as an error was a 500 on every output endpoint.
    """
    path = os.path.join(run_path, "config", "realization.json")
    try:
        with open(path, "r") as handle:
            declared = json.load(handle).get("output_root")
    except FileNotFoundError:
        return _DEFAULT_OUTPUT_SUBDIR
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Could not read %s: %s", path, exc)
        return _DEFAULT_OUTPUT_SUBDIR

    if not declared:
        return _DEFAULT_OUTPUT_SUBDIR
    relative = declared.split("outputs")[-1].strip("/")
    return os.path.join("outputs", relative or "ngen")


def _find_gpkg(run_path):
    """The first GeoPackage under config/, run-relative, or None."""
    config_dir = os.path.join(run_path, "config")
    for root, _dirs, files in os.walk(config_dir):
        for name in sorted(files):
            if name.endswith(".gpkg"):
                return os.path.relpath(os.path.join(root, name), run_path)
    return None


def _bounds(gpkg_path, layers=("divides", "nexus")):
    """[west, south, east, north] in EPSG:4326, from the first readable layer header.

    Same approach as utils.gpkg_layer_bounds_4326: read_info reads the header rather than the
    features, and transform_bounds densifies the edges so a box in a projected CRS does not
    shrink when the projection curves it.
    """
    import pyogrio
    from pyproj import Transformer

    for layer in layers:
        try:
            info = pyogrio.read_info(gpkg_path, layer=layer)
        except Exception:
            continue

        raw = info.get("total_bounds")
        if raw is None or not len(raw):
            continue

        crs = info.get("crs")
        if not crs:
            return [float(value) for value in raw]
        try:
            transformer = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
            return [float(value) for value in transformer.transform_bounds(*raw)]
        except Exception:
            logger.warning("Could not reproject %s bounds from %s", layer, crs)
            continue
    return None


def _crosswalk_rows(gpkg_path):
    """(flowpath id, divide id) pairs, read out of the GeoPackage's flowpaths table.

    Read verbatim rather than derived. This hydrofabric numbers flowpaths and divides alike,
    so wb-2863630 pairs with cat-2863630 -- but describe_troute_feature reads the pairing
    instead of assuming it, because that is a convention of the fabric and not a guarantee.
    Deriving one id from the other here would reintroduce the assumption the incumbent code
    deliberately avoids.
    """
    try:
        with sqlite3.connect(f"file:{gpkg_path}?mode=ro", uri=True) as connection:
            return connection.execute("SELECT id, divide_id FROM flowpaths").fetchall()
    except sqlite3.Error as exc:
        logger.warning("Could not read flowpaths from %s: %s", gpkg_path, exc)
        return []


def _catchment_ids(output_dir):
    """Catchment ids present in the output directory, extension stripped, sorted."""
    stems = set()
    try:
        names = os.listdir(output_dir)
    except OSError:
        return []

    for name in names:
        if not name.startswith("cat-"):
            continue
        for suffix in _OUTPUT_SUFFIXES:
            if name.endswith(suffix):
                stems.add(name[: -len(suffix)])
                break
    return sorted(stems)


def _output_format(output_dir):
    """Which suffix the reader will actually use, parquet winning when both are present."""
    try:
        names = os.listdir(output_dir)
    except OSError:
        return None
    for suffix in _OUTPUT_SUFFIXES:
        if any(name.startswith("cat-") and name.endswith(suffix) for name in names):
            return suffix
    return None


def _troute(run_path):
    """The t-route source file and its per-variable CF metadata, or None.

    The metadata is the part that cannot survive a naive conversion: parquet carries no
    netCDF attributes and ``duckdb.query(...).df()`` does not expose parquet key-value
    metadata either, while get_troute_vars builds every picker label from long_name and
    units. Capturing it here is what lets Unit 11 convert at all.
    """
    troute_dir = os.path.join(run_path, _TROUTE_SUBDIR)
    try:
        names = sorted(os.listdir(troute_dir))
    except OSError:
        return None

    for suffix in (".csv", ".nc"):
        for name in names:
            if not name.endswith(suffix):
                continue
            record = {
                "file": os.path.join(_TROUTE_SUBDIR, name),
                "format": suffix,
                "variables": {},
            }
            if suffix == ".nc":
                record["variables"] = _netcdf_variable_meta(os.path.join(troute_dir, name))
            return record
    return None


def _netcdf_variable_meta(path):
    """long_name and units per data variable, as t-route declares them."""
    import xarray as xr

    try:
        with xr.open_dataset(path) as dataset:
            return {
                str(name): {
                    key: value
                    for key, value in dataset[name].attrs.items()
                    if key in ("long_name", "units")
                }
                for name in dataset.data_vars
            }
    except Exception as exc:
        logger.warning("Could not read variable metadata from %s: %s", path, exc)
        return {}


def _teehr(run_path, fallback_configuration_name=""):
    """Whether this run carries its own TEEHR evaluation, and the producer's config name.

    ``present`` replaces evaluation_dir's ``os.path.isdir``, which is False for every
    ``s3://`` path regardless of what is actually there -- so without this every TEEHR
    endpoint on a hosted run reports "no evaluation" while the parquet sits in the bucket.

    The configuration name is read from the producer's manifest under the key
    ``teehr_configuration_name``. Reading the unprefixed ``configuration_name`` returned
    empty for every real manifest, which is the bug commit b80395b fixed.

    ``fallback_configuration_name`` is what the registry row held, and it is used only when
    the run carries no producer manifest to read. That case is not hypothetical: the value
    was captured at registration from a manifest that may since have been removed, or the run
    may have been registered by hand -- and without the fallback the backfill would drop it,
    which is the one TEEHR fact this app cannot re-derive from the run directory.
    """
    joined = os.path.join(run_path, "teehr", "dataset", "joined_timeseries")
    present = os.path.isdir(joined)

    configuration_name = ""
    producer = os.path.join(run_path, "teehr_run_manifest.json")
    try:
        with open(producer, "r") as handle:
            configuration_name = json.load(handle).get("teehr_configuration_name", "") or ""
    except (OSError, ValueError):
        configuration_name = ""

    return {
        "present": present,
        "configuration_name": configuration_name or fallback_configuration_name or "",
    }


def _version_token(run_path, output_dir, catchments, gpkg_relative):
    """A content-derived key that changes when the run's outputs do.

    Replaces ``_output_fingerprint``, which is ``os.stat(directory)`` and returns None for an
    S3 prefix -- leaving the cache key constant, so a re-ingested run would serve stale bins
    forever.

    Derived from content rather than minted randomly because Unit 7's backfill runs on every
    container start and must be idempotent: a random token would rewrite every manifest each
    time and invalidate every cache with it.
    """
    digest = hashlib.sha256()
    for name in sorted(os.listdir(output_dir)) if os.path.isdir(output_dir) else []:
        full = os.path.join(output_dir, name)
        try:
            digest.update(f"{name}:{os.path.getsize(full)}".encode())
        except OSError:
            digest.update(f"{name}:?".encode())
    digest.update(f"|catchments:{len(catchments)}".encode())

    # The gpkg counts too; it is the only source for both the crosswalk and the bounds.
    if gpkg_relative:
        full = os.path.join(run_path, gpkg_relative)
        try:
            digest.update(f"|gpkg:{gpkg_relative}:{os.path.getsize(full)}".encode())
        except OSError:
            digest.update(f"|gpkg:{gpkg_relative}:?".encode())

    return digest.hexdigest()[:32]


def distill(
    run_path,
    *,
    run_id=None,
    label=None,
    created=None,
    legacy_uuids=(),
    teehr_configuration_name="",
):
    """Read a run directory and return its manifest document.

    Pure with respect to the run: it reads, it does not write. ``write`` puts the result on
    disk. Splitting them keeps the expensive, failure-prone part testable without a
    filesystem round trip, and lets the backfill compare a freshly distilled document against
    one already stored.
    """
    run_path = str(run_path).rstrip(os.sep)
    output_relative = _read_realization_output_dir(run_path)
    output_dir = os.path.join(run_path, output_relative)

    catchments = _catchment_ids(output_dir)
    gpkg_relative = _find_gpkg(run_path)
    crosswalk = _crosswalk_rows(os.path.join(run_path, gpkg_relative)) if gpkg_relative else []

    return {
        "schema_version": SCHEMA_VERSION,
        "id": run_id or os.path.basename(run_path),
        "label": label or os.path.basename(run_path),
        "created": created,
        "legacy_uuids": [normalize_uuid(value) for value in legacy_uuids],
        "output_dir": output_relative,
        "output_format": _output_format(output_dir),
        "catchment_count": len(catchments),
        "gpkg": gpkg_relative,
        "bounds": _bounds(os.path.join(run_path, gpkg_relative)) if gpkg_relative else None,
        "crosswalk_count": len(crosswalk),
        "troute": _troute(run_path),
        "teehr": _teehr(run_path, teehr_configuration_name),
        "version_token": _version_token(run_path, output_dir, catchments, gpkg_relative),
        "_catchments": catchments,
        "_crosswalk": crosswalk,
    }


def write(run_path, document):
    """Write the hot manifest and its sidecars into the run directory.

    The two underscore-prefixed keys carry the bulk out of ``distill`` and are stripped here:
    they belong in sidecars, not in the document the run picker parses for every run on every
    request.
    """
    run_path = str(run_path).rstrip(os.sep)
    catchments = document.get("_catchments", [])
    crosswalk = document.get("_crosswalk", [])

    hot = {key: value for key, value in document.items() if not key.startswith("_")}
    with open(os.path.join(run_path, MANIFEST_NAME), "w") as handle:
        json.dump(hot, handle, indent=2, sort_keys=True)
        handle.write("\n")

    with open(os.path.join(run_path, CATCHMENTS_SIDECAR), "w") as handle:
        json.dump(catchments, handle)
        handle.write("\n")

    _write_crosswalk(os.path.join(run_path, CROSSWALK_SIDECAR), crosswalk)

    # A rewritten run in this process must not keep serving the previous sidecars.
    clear_caches()
    return hot


def _write_crosswalk(path, rows):
    """Write the crosswalk as parquet, via DuckDB.

    Parquet rather than JSON because this is the field that grows without bound -- one row
    per flowpath -- and DuckDB rather than pandas because pyarrow is deliberately absent from
    the image, the same reason convert_outputs.py gives.
    """
    import pandas as pd

    frame = pd.DataFrame(
        [{"flowpath_id": str(a), "divide_id": None if b is None else str(b)} for a, b in rows],
        columns=["flowpath_id", "divide_id"],
    )
    connection = duckdb_conn.connect_isolated()
    try:
        connection.register("crosswalk_frame", frame)
        connection.execute(
            f"COPY (SELECT * FROM crosswalk_frame) TO {duckdb_conn.quote(path)} "
            "(FORMAT PARQUET, COMPRESSION ZSTD)"
        )
    finally:
        connection.close()


def read(run_path):
    """The hot manifest for a run, or None when it has not been distilled."""
    path = os.path.join(str(run_path).rstrip(os.sep), MANIFEST_NAME)
    try:
        with open(path, "r") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        logger.warning("Could not read %s: %s", path, exc)
        return None


def _version_of(run_path):
    """The stored version token, used as the sidecar cache key. Empty when undistilled."""
    document = read(run_path) or {}
    return document.get("version_token", "")


@functools.lru_cache(maxsize=32)
def _catchments_cached(run_path, version_token):
    path = os.path.join(run_path, CATCHMENTS_SIDECAR)
    try:
        with open(path, "r") as handle:
            return tuple(json.load(handle))
    except (OSError, ValueError):
        return ()


def catchments(run_path):
    """The run's catchment ids, from the sidecar.

    Cached on the version token rather than on mtime, because an object-store prefix has no
    mtime -- that is the whole reason the token exists.
    """
    run_path = str(run_path).rstrip(os.sep)
    return list(_catchments_cached(run_path, _version_of(run_path)))


@functools.lru_cache(maxsize=8)
def _crosswalk_cached(run_path, version_token):
    path = os.path.join(run_path, CROSSWALK_SIDECAR)
    if not os.path.exists(path):
        return {}
    frame = duckdb_conn.query(f"SELECT * FROM read_parquet({duckdb_conn.quote(path)})")
    return dict(zip(frame["flowpath_id"], frame["divide_id"]))


def crosswalk(run_path):
    """The whole flowpath-to-divide mapping, as a dict.

    Loaded whole rather than filtered per feature, and cached, because both halves matter.
    describe_troute_feature looks up an arbitrary feature id behind an lru_cache of 32, so a
    per-feature read would move the per-feature cost from SQLite to a parquet scan rather
    than remove it -- measured at 80 ms for a 10,000-flowpath run, which is a fifth of a
    second of clicking around the map. Cached whole it is paid once per run per ingest.
    """
    run_path = str(run_path).rstrip(os.sep)
    return dict(_crosswalk_cached(run_path, _version_of(run_path)))


def clear_caches():
    """Drop the sidecar caches. For tests and for a process that has just re-ingested."""
    _catchments_cached.cache_clear()
    _crosswalk_cached.cache_clear()
