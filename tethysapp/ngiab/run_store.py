"""Where model runs live, and how to list them.

Locates run directories on local disk or object storage and lists them via Django storage.
"""

import contextlib
import functools
import json
import logging
import os
import posixpath
import shutil
import time

from . import duckdb_conn, manifest

logger = logging.getLogger(__name__)

MANAGED_ROOT_ENV = "NGIAB_MANAGED_ROOT"
PERSIST_ENV = "TETHYS_PERSIST"
DEFAULT_PERSIST = "/home/tethys/persist"
MANAGED_DIR_NAME = "ngiab_visualizer"

STORAGE_ALIAS = "ngiab_runs"

RUNS_PREFIX_ENV = "NGIAB_RUNS_PREFIX"
DEFAULT_RUNS_PREFIX = "ngiab_visualizer"

LISTING_CONCURRENCY = int(os.environ.get("NGIAB_LISTING_CONCURRENCY", "10"))

LISTING_TTL_ENV = "NGIAB_LISTING_TTL_SECONDS"
DEFAULT_LISTING_TTL_SECONDS = 10.0

_NOT_INGESTED = (
    "This directory has no manifest yet. Run: tethys manage write_manifest --path <run> "
    "(it carries over the name and shared link from ngiab_visualizer.json when that file "
    "is still beside it)."
)
_NO_OUTPUTS = "No catchment outputs in this run, so there is nothing to plot."
_UNREADABLE = "This run's manifest could not be read."
_UNSUPPORTED_SCHEMA = (
    "This run's manifest uses schema version {found}, which this version of the visualizer "
    "does not understand (it reads up to {supported})."
)


class StorageUnreachable(RuntimeError):
    """Raised when the storage backend itself fails, as distinct from holding no runs."""


def local_root():
    """The filesystem directory holding run directories.

    Derived from TETHYS_PERSIST rather than fixed, so moving the persist directory moves the
    runs with it. A hardcoded path let the two drift apart silently: nothing errors, the
    listing just comes up empty against a directory nobody writes to.
    """
    override = os.environ.get(MANAGED_ROOT_ENV)
    if override:
        return override
    persist = os.environ.get(PERSIST_ENV) or DEFAULT_PERSIST
    return os.path.join(persist, MANAGED_DIR_NAME)


def storage():
    """The Django storage addressing the run root, chosen by the backend predicate."""
    from django.core.files.storage import FileSystemStorage, storages

    if not duckdb_conn.is_object_storage():
        return FileSystemStorage(location=local_root())

    try:
        return storages[STORAGE_ALIAS]
    except Exception:  # noqa: BLE001 - InvalidStorageError is not importable across versions
        return _borrowed_from_default()


def runs_prefix():
    """The prefix runs live under inside the portal's media bucket."""
    return os.environ.get(RUNS_PREFIX_ENV, DEFAULT_RUNS_PREFIX).strip("/")


@functools.lru_cache(maxsize=4)
def _backend_for(path, options):
    """One backend instance per distinct configuration, since each build opens a client."""
    from django.utils.module_loading import import_string

    return import_string(path)(**dict(options))


def _borrowed_from_default():
    """A storage on the portal's media bucket, re-pointed at the runs prefix."""
    from django.conf import settings

    entry = (getattr(settings, "STORAGES", None) or {}).get("default")
    if not entry or not entry.get("BACKEND"):
        raise StorageUnreachable(
            f"Runs are configured as object storage, but neither a {STORAGE_ALIAS!r} storage "
            "nor a usable 'default' storage is defined for this portal."
        )

    options = dict(entry.get("OPTIONS") or {})
    base = str(options.get("location") or "").strip("/")
    prefix = runs_prefix()
    options["location"] = posixpath.join(base, prefix) if base else prefix

    return _backend_for(entry["BACKEND"], tuple(sorted(options.items())))


def _bucket_uri():
    """The ``s3://bucket/prefix`` base for the configured object store."""
    backend = storage()
    bucket = getattr(backend, "bucket_name", None)
    if not bucket:
        raise StorageUnreachable(
            f"The {STORAGE_ALIAS!r} storage declares no bucket_name, so run locations cannot "
            "be addressed."
        )
    prefix = (getattr(backend, "location", "") or "").strip("/")
    return f"s3://{bucket}/{prefix}" if prefix else f"s3://{bucket}"


def duckdb_secret_sql():
    """A ``CREATE SECRET`` statement for the storage DuckDB is about to read, or None."""
    if not duckdb_conn.is_object_storage():
        return None

    backend = storage()
    key = getattr(backend, "access_key", None)
    secret = getattr(backend, "secret_key", None)
    token = getattr(backend, "security_token", None)

    parts = ["TYPE s3"]
    if key and secret:
        parts.append(f"KEY_ID {duckdb_conn.quote(key)}")
        parts.append(f"SECRET {duckdb_conn.quote(secret)}")
        if token:
            parts.append(f"SESSION_TOKEN {duckdb_conn.quote(token)}")
    else:
        parts.append("PROVIDER credential_chain")

    region = getattr(backend, "region_name", None)
    if region:
        parts.append(f"REGION {duckdb_conn.quote(region)}")

    endpoint = getattr(backend, "endpoint_url", None)
    if endpoint:
        without_scheme = str(endpoint).split("://", 1)[-1].rstrip("/")
        parts.append(f"ENDPOINT {duckdb_conn.quote(without_scheme)}")
        parts.append("URL_STYLE 'path'")
        parts.append("USE_SSL " + ("true" if str(endpoint).startswith("https") else "false"))

    return "CREATE OR REPLACE SECRET ngiab_runs_s3 (" + ", ".join(parts) + ")"


def location(name, *parts):
    """A location string DuckDB can read, for a path inside one run."""
    if duckdb_conn.is_object_storage():
        return posixpath.join(_bucket_uri(), name, *parts)
    return os.path.join(local_root(), name, *parts)


def _read_manifest(name):
    """The hot manifest for one run, or None when it has none or cannot be read."""
    backend = storage()
    key = posixpath.join(name, manifest.MANIFEST_NAME)
    try:
        with backend.open(key) as handle:
            payload = handle.read()
    except FileNotFoundError:
        return None
    except Exception as exc:
        if _is_missing(exc):
            return None
        raise StorageUnreachable(str(exc)) from exc

    try:
        if isinstance(payload, bytes):
            payload = payload.decode("utf-8")
        return json.loads(payload)
    except (UnicodeDecodeError, ValueError) as exc:
        logger.warning("Could not parse the manifest for %s: %s", name, exc)
        return False


def _is_missing(exc):
    """Whether a storage error means "no such key" rather than "storage is broken"."""
    code = getattr(getattr(exc, "response", None), "get", lambda _k, _d=None: None)(
        "Error", {}
    )
    if isinstance(code, dict) and str(code.get("Code")) in ("404", "NoSuchKey"):
        return True
    return isinstance(exc, FileNotFoundError)


def _describe(name):
    """One run's listing entry: where it is, what it is, and if unusable, why."""
    document = _read_manifest(name)
    base = {"name": name, "path": location(name)}

    if document is False:
        return {**base, "manifest": None, "usable": False, "reason": _UNREADABLE}
    if document is None:
        return {**base, "manifest": None, "usable": False, "reason": _NOT_INGESTED}

    version = document.get("schema_version")
    if not isinstance(version, int) or version > manifest.SCHEMA_VERSION:
        return {
            **base,
            "manifest": document,
            "usable": False,
            "reason": _UNSUPPORTED_SCHEMA.format(
                found=version, supported=manifest.SCHEMA_VERSION
            ),
        }

    if not document.get("output_format"):
        return {**base, "manifest": document, "usable": False, "reason": _NO_OUTPUTS}
    return {**base, "manifest": document, "usable": True, "reason": None}


def _created_of(entry):
    return (entry.get("manifest") or {}).get("created") or ""


def _label_of(entry):
    return (entry.get("manifest") or {}).get("label") or entry["name"]


def _ordered(entries):
    """Sort entries newest first, then by label."""
    by_label = sorted(entries, key=_label_of)
    return sorted(by_label, key=_created_of, reverse=True)


def listing_ttl_seconds():
    """Seconds a cached listing may be stale. Zero disables caching."""
    try:
        return max(float(os.environ.get(LISTING_TTL_ENV, DEFAULT_LISTING_TTL_SECONDS)), 0.0)
    except ValueError:
        return DEFAULT_LISTING_TTL_SECONDS


def _time_bucket():
    """A value that changes once per TTL window, used as part of the cache key."""
    ttl = listing_ttl_seconds()
    if ttl <= 0:
        return time.monotonic()
    return int(time.monotonic() // ttl)


@functools.lru_cache(maxsize=2)
def _cached_listing(root_key, time_bucket):
    backend = storage()
    try:
        directories, _files = backend.listdir("")
    except FileNotFoundError:
        return ()
    except StorageUnreachable:
        raise
    except Exception as exc:
        raise StorageUnreachable(f"Could not list runs at {root_key}: {exc}") from exc

    names = [name for name in directories if not is_reserved(name)]
    if len(names) <= 1:
        return tuple(_ordered([_describe(name) for name in names]))

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=min(LISTING_CONCURRENCY, len(names))) as pool:
        described = list(pool.map(_describe, names))
    return tuple(_ordered(described))


def is_reserved(name):
    """Whether this directory belongs to the machinery rather than to a user."""
    return name.startswith("_")


STAGING_DIR = "_uploads"

CLAIM_DIR = posixpath.join(STAGING_DIR, "claims")


def list_runs():
    """Every run under the storage root, newest first, unusable ones included."""
    return [dict(entry) for entry in _cached_listing(_root_key(), _time_bucket())]


def find(name):
    """One run's entry by name, or None."""
    for entry in list_runs():
        if entry["name"] == name:
            return entry
    return None


def _root_key():
    """Identifies the current root, so a backend switch does not serve a stale listing."""
    if not duckdb_conn.is_object_storage():
        return local_root()
    backend = storage()
    bucket = getattr(backend, "bucket_name", None)
    prefix = getattr(backend, "location", "") or ""
    return f"{bucket or type(backend).__name__}/{prefix}"


def delete(name):
    """Remove one run and everything under it. Irreversible."""
    if not _is_plain_name(name) or find(name) is None:
        raise LookupError(name)

    if duckdb_conn.is_object_storage():
        delete_prefix(storage(), name)
    else:
        shutil.rmtree(_contained_directory(name))

    clear_caches()


def _is_plain_name(name):
    """A run name is one path component. Anything else is not a run being named."""
    return bool(name) and name not in (".", "..") and os.sep not in name and "/" not in name


def _contained_directory(name):
    """The run's real directory, or LookupError if it is not genuinely inside the root."""
    root = os.path.realpath(local_root())
    target = os.path.join(root, name)
    if os.path.islink(target) or not os.path.isdir(target):
        raise LookupError(name)

    real = os.path.realpath(target)
    if real != root and not real.startswith(root + os.sep):
        raise LookupError(name)
    return real


def delete_prefix(backend, prefix, keys=None):
    """Delete every object under a prefix."""
    keys = list(keys) if keys is not None else list(_walk_keys(backend, prefix))
    if not keys:
        return

    client, bucket = _s3_client(backend)
    if client is None or not bucket:
        for key in keys:
            backend.delete(key)
        return

    failures = []
    for chunk in (keys[i:i + 1000] for i in range(0, len(keys), 1000)):
        response = client.delete_objects(
            Bucket=bucket,
            Delete={
                "Objects": [{"Key": raw_key(backend, key)} for key in chunk],
                "Quiet": True,
            },
        )
        failures.extend(response.get("Errors") or [])

    if failures:
        detail = ", ".join(
            f"{item.get('Key')}: {item.get('Code')}" for item in failures[:5]
        )
        raise StorageUnreachable(
            f"{len(failures)} object(s) under {prefix!r} could not be deleted: {detail}"
        )


def _walk_keys(backend, prefix):
    """Every object key under ``prefix``, depth first."""
    directories, files = backend.listdir(prefix)
    for name in files:
        yield posixpath.join(prefix, name)
    for name in directories:
        yield from _walk_keys(backend, posixpath.join(prefix, name))


@contextlib.contextmanager
def claimed(name):
    """Hold ``name`` for the duration, so a second publisher cannot use it concurrently."""
    if not duckdb_conn.is_object_storage():
        yield
        return

    backend = storage()
    client, bucket = _s3_client(backend)
    if client is None:
        logger.warning("No S3 client for %s; publishing without a claim", name)
        yield
        return

    key = _claim_key(backend, name)
    if not _take_claim(client, bucket, key, name):
        raise ClaimHeld(
            f"Another upload is already publishing a run called {name!r}. Wait for it to "
            "finish, or upload under a different name."
        )
    try:
        yield
    finally:
        try:
            client.delete_object(Bucket=bucket, Key=key)
        except Exception:  # noqa: BLE001 - a stale claim expires; failing here helps nobody
            logger.warning("Could not release the claim on %s", name, exc_info=True)


class ClaimHeld(RuntimeError):
    """Raised when another publisher holds the run name."""


def raw_key(backend, key):
    """``key`` with the backend's own prefix applied, for a call that bypasses the backend."""
    location = (getattr(backend, "location", "") or "").strip("/")
    return posixpath.join(location, key) if location else key


def _s3_client(backend):
    """The backend's boto3 client and bucket, or (None, None) when it has none."""
    meta = getattr(getattr(backend, "connection", None), "meta", None)
    return getattr(meta, "client", None), getattr(backend, "bucket_name", None)


def _claim_key(backend, name):
    return raw_key(backend, posixpath.join(CLAIM_DIR, name))


def _take_claim(client, bucket, key, name):
    """Write the claim, or report that someone else holds it."""
    body = json.dumps({"run": name, "claimed": time.time()}).encode("utf-8")
    try:
        client.put_object(Bucket=bucket, Key=key, Body=body, IfNoneMatch="*")
        return True
    except Exception as exc:  # noqa: BLE001 - classified below
        if not _is_precondition_failure(exc):
            logger.warning(
                "Conditional claim unsupported or failed for %s; publishing without one",
                name, exc_info=True,
            )
            return True

    if not _claim_is_stale(client, bucket, key):
        return False

    logger.warning("Breaking a stale claim on %s", name)
    try:
        client.delete_object(Bucket=bucket, Key=key)
        client.put_object(Bucket=bucket, Key=key, Body=body, IfNoneMatch="*")
        return True
    except Exception:  # noqa: BLE001 - lost the race to break it, which is a collision
        return False


def _is_precondition_failure(exc):
    """Whether the store refused the write because the key already existed."""
    response = getattr(exc, "response", None)
    if not isinstance(response, dict):
        return False
    error = response.get("Error") or {}
    status = (response.get("ResponseMetadata") or {}).get("HTTPStatusCode")
    return str(error.get("Code")) == "PreconditionFailed" or status == 412


def _claim_is_stale(client, bucket, key):
    """Whether an existing claim is old enough that its publisher is presumed gone."""
    from .ingest import STALE_AFTER_SECONDS

    try:
        body = client.get_object(Bucket=bucket, Key=key)["Body"].read()
        claimed_at = json.loads(body).get("claimed")
    except Exception:  # noqa: BLE001 - unreadable claim is not evidence it is abandoned
        return False
    if not isinstance(claimed_at, (int, float)):
        return False
    return (time.time() - claimed_at) > STALE_AFTER_SECONDS


def clear_caches():
    """Drop the cached listing. Called after ingest, after removal, and by tests."""
    _cached_listing.cache_clear()
    manifest.clear_caches()
