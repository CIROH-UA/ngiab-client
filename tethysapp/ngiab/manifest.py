"""What ingest distills from a run so the read path never probes the filesystem.

Computes and stores a per-run manifest plus sidecars, so the run picker never touches disk.
"""

import functools
import hashlib
import json
import logging
import os
import posixpath
import re
import sqlite3

from . import duckdb_conn

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1

MANIFEST_NAME = "manifest.json"
CATCHMENTS_SIDECAR = "manifest_catchments.parquet"
CROSSWALK_SIDECAR = "manifest_crosswalk.parquet"

CONSOLIDATED_PREFIX = "catchments-"

_OUTPUT_SUFFIXES = (".parquet", ".csv")

_DEFAULT_OUTPUT_SUBDIR = os.path.join("outputs", "ngen")
_TROUTE_SUBDIR = os.path.join("outputs", "troute")

_UUID_CHARS = re.compile(r"[0-9a-f]{32}\Z")


def normalize_uuid(value):
    """Reduce either UUID spelling to the 32-character undashed form Django stores."""
    candidate = str(value or "").strip().lower().replace("-", "")
    return candidate if _UUID_CHARS.match(candidate) else str(value or "").strip()


def _read_realization_output_dir(run_path):
    """The run-relative output directory, from realization.json's ``output_root``."""
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
    relative = str(declared).split("outputs")[-1].strip("/")
    return contained_output_dir(os.path.join("outputs", relative or "ngen"))


def contained_output_dir(candidate):
    """``candidate`` if it stays inside the run, the default otherwise."""
    if not candidate:
        return _DEFAULT_OUTPUT_SUBDIR
    normalised = posixpath.normpath(str(candidate).replace(os.sep, "/"))
    if normalised.startswith(("/", "../")) or normalised in ("..", "."):
        logger.warning("Refusing an output_root that leaves the run: %r", candidate)
        return _DEFAULT_OUTPUT_SUBDIR
    return normalised


def _find_gpkg(run_path):
    """The first GeoPackage under config/, run-relative, or None."""
    config_dir = os.path.join(run_path, "config")
    for root, _dirs, files in os.walk(config_dir):
        for name in sorted(files):
            if name.endswith(".gpkg"):
                return os.path.relpath(os.path.join(root, name), run_path)
    return None


def _bounds(gpkg_path, layers=("divides", "nexus")):
    """[west, south, east, north] in EPSG:4326, from the first readable layer header."""
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
    """(flowpath id, divide id) pairs, read out of the GeoPackage's flowpaths table."""
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


def _output_layout(output_dir):
    """How this run's catchment outputs are arranged, and in what format."""
    try:
        names = os.listdir(output_dir)
    except OSError:
        return None, []

    groups = sorted(n for n in names if n.startswith(CONSOLIDATED_PREFIX) and n.endswith(".parquet"))
    if groups:
        return ".parquet", groups

    for suffix in _OUTPUT_SUFFIXES:
        if any(name.startswith("cat-") and name.endswith(suffix) for name in names):
            return suffix, []
    return None, []


def _consolidated_catchments(output_dir, groups):
    """Which consolidated group holds each catchment: ``{"cat-100": 0, ...}``."""
    membership = {}
    for index, name in enumerate(groups):
        path = os.path.join(output_dir, name)
        try:
            frame = duckdb_conn.query(
                f"SELECT DISTINCT catchment_id FROM read_parquet({duckdb_conn.quote(path)})"
            )
        except Exception as exc:  # noqa: BLE001 - a bad group must not lose the others
            logger.warning("Could not read catchment ids from %s: %s", path, exc)
            continue
        for value in frame["catchment_id"]:
            membership[str(value)] = index
    return membership


def _troute(run_path):
    """The t-route source file and its per-variable CF metadata, or None."""
    troute_dir = os.path.join(run_path, _TROUTE_SUBDIR)
    try:
        names = sorted(os.listdir(troute_dir))
    except OSError:
        return None

    for suffix in (".parquet", ".csv", ".nc"):
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
            elif suffix == ".parquet":
                record["variables"] = _troute_meta_from_source(troute_dir, names)
            return record
    return None


def _troute_meta_from_source(troute_dir, names):
    """CF metadata for a converted run, read from the NetCDF it was converted from."""
    for name in names:
        if name.endswith(".nc"):
            return _netcdf_variable_meta(os.path.join(troute_dir, name))
    return {}


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
    """Whether this run carries its own TEEHR evaluation, and the producer's config name."""
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
    """A content-derived key that changes when the run's outputs do."""
    digest = hashlib.sha256()
    for name in sorted(os.listdir(output_dir)) if os.path.isdir(output_dir) else []:
        full = os.path.join(output_dir, name)
        try:
            digest.update(f"{name}:{os.path.getsize(full)}".encode())
        except OSError:
            digest.update(f"{name}:?".encode())
    digest.update(f"|catchments:{len(catchments)}".encode())

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
    """Read a run directory and return its manifest document."""
    run_path = str(run_path).rstrip(os.sep)
    output_relative = _read_realization_output_dir(run_path)
    output_dir = os.path.join(run_path, output_relative)

    output_format, output_groups = _output_layout(output_dir)
    membership = _consolidated_catchments(output_dir, output_groups)
    if not membership:
        membership = {stem: 0 for stem in _catchment_ids(output_dir)}
    catchments = sorted(membership)
    gpkg_relative = _find_gpkg(run_path)
    crosswalk = _crosswalk_rows(os.path.join(run_path, gpkg_relative)) if gpkg_relative else []

    return {
        "schema_version": SCHEMA_VERSION,
        "id": run_id or os.path.basename(run_path),
        "label": label or os.path.basename(run_path),
        "created": created,
        "legacy_uuids": [normalize_uuid(value) for value in legacy_uuids],
        "output_dir": output_relative,
        "output_format": output_format,
        "output_groups": output_groups,
        "catchment_count": len(catchments),
        "gpkg": gpkg_relative,
        "bounds": _bounds(os.path.join(run_path, gpkg_relative)) if gpkg_relative else None,
        "crosswalk_count": len(crosswalk),
        "troute": _troute(run_path),
        "teehr": _teehr(run_path, teehr_configuration_name),
        "version_token": _version_token(run_path, output_dir, catchments, gpkg_relative),
        "_catchments": membership,
        "_crosswalk": crosswalk,
    }


def write(run_path, document):
    """Write the hot manifest and its sidecars into the run directory."""
    run_path = str(run_path).rstrip(os.sep)
    catchments = document.get("_catchments", {})
    crosswalk = document.get("_crosswalk", [])

    hot = {key: value for key, value in document.items() if not key.startswith("_")}
    with open(os.path.join(run_path, MANIFEST_NAME), "w") as handle:
        json.dump(hot, handle, indent=2, sort_keys=True)
        handle.write("\n")

    _write_catchments(os.path.join(run_path, CATCHMENTS_SIDECAR), catchments)
    _write_crosswalk(os.path.join(run_path, CROSSWALK_SIDECAR), crosswalk)

    clear_caches()
    return hot


def _write_catchments(path, membership):
    """The catchment-to-group mapping, as parquet."""
    import pandas as pd

    frame = pd.DataFrame(
        sorted(membership.items()), columns=["catchment_id", "group_index"]
    ).astype({"catchment_id": "str", "group_index": "int64"})
    _copy_frame_to_parquet(frame, "catchments_frame", path)


def _copy_frame_to_parquet(frame, name, path):
    """Write one small frame through an isolated connection."""
    connection = duckdb_conn.connect_isolated()
    try:
        connection.register(name, frame)
        connection.execute(
            f"COPY (SELECT * FROM {name}) TO {duckdb_conn.quote(path)} "
            "(FORMAT PARQUET, COMPRESSION ZSTD)"
        )
    finally:
        connection.close()


def _write_crosswalk(path, rows):
    """Write the crosswalk as parquet, via DuckDB."""
    import pandas as pd

    frame = pd.DataFrame(
        [{"flowpath_id": str(a), "divide_id": None if b is None else str(b)} for a, b in rows],
        columns=["flowpath_id", "divide_id"],
    )
    _copy_frame_to_parquet(frame, "crosswalk_frame", path)


def child(base, *parts):
    """Join below a run's location, whether that is a path or an ``s3://`` URI."""
    return posixpath.join(str(base), *[str(part).strip("/") for part in parts if part])


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
    """The id-to-group mapping, read through DuckDB so an s3:// path works."""
    frame = _read_sidecar(child(run_path, CATCHMENTS_SIDECAR))
    if frame is None:
        return {}
    return {
        str(cid): int(group)
        for cid, group in zip(frame["catchment_id"], frame["group_index"])
    }


def _read_sidecar(path):
    """One sidecar as a frame, or None when the run simply has not got one."""
    try:
        return duckdb_conn.query(f"SELECT * FROM read_parquet({duckdb_conn.quote(path)})")
    except Exception as exc:  # noqa: BLE001 - re-raised below unless it means "not there"
        if duckdb_conn.is_missing_error(exc):
            return None
        from .run_store import StorageUnreachable

        raise StorageUnreachable(f"Could not read {path}: {exc}") from exc


def catchments(run_path, version_token=None):
    """The run's catchment ids, from the sidecar."""
    run_path = str(run_path).rstrip(os.sep)
    return sorted(_catchments_cached(run_path, _token(run_path, version_token)))


def catchment_group(run_path, stem, version_token=None):
    """Which consolidated group holds one catchment, or None when it is not this run's."""
    run_path = str(run_path).rstrip(os.sep)
    return _catchments_cached(run_path, _token(run_path, version_token)).get(stem)


def _token(run_path, supplied):
    """The caller's token, or a filesystem read when there is none to supply."""
    return supplied if supplied is not None else _version_of(run_path)


@functools.lru_cache(maxsize=32)
def _crosswalk_cached(run_path, version_token):
    """Read the crosswalk sidecar through DuckDB, without an os.path.exists guard."""
    frame = _read_sidecar(child(run_path, CROSSWALK_SIDECAR))
    if frame is None:
        return {}
    return dict(zip(frame["flowpath_id"], frame["divide_id"]))


def divide_for(run_path, flowpath_id, version_token=None):
    """The divide a single flowpath maps to, or None."""
    run_path = str(run_path).rstrip(os.sep)
    return _crosswalk_cached(run_path, _token(run_path, version_token)).get(flowpath_id)


def crosswalk(run_path, version_token=None):
    """The whole flowpath-to-divide mapping, as a dict."""
    run_path = str(run_path).rstrip(os.sep)
    return dict(_crosswalk_cached(run_path, _token(run_path, version_token)))


def clear_caches():
    """Drop the sidecar caches. For tests and for a process that has just re-ingested."""
    _catchments_cached.cache_clear()
    _crosswalk_cached.cache_clear()
