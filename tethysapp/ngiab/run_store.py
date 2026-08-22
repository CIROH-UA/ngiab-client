"""Where model runs live, and how to list them.

One directory per run under a storage root. Locally that root is the bind mount the launcher
already creates; when hosted it is a prefix in an object store. Everything above this module
sees the same list either way.

**The local root is the existing ``ngiab_visualizer`` mount, not MEDIA_ROOT.** MEDIA_ROOT
resolves to ``$TETHYS_PERSIST_PATH/media``, which nothing mounts -- Tethys reads it from the
portal config rather than the environment, so the variable the launcher exports is inert.
Every run that exists today lives in ``ngiab_visualizer``, which ``viewOnTethys.sh`` does
mount. Rooting the store anywhere else would put every existing run outside it, and once
``register_run`` is gone there would be no way to add them back: an image upgrade that
silently empties the run picker. Using the mount that already exists means no data moves and
no new configuration.

**Listing goes through the Django storage interface**, so the same code serves both backends.
For an object store there are no directories -- ``listdir`` derives them from key prefixes,
which is what ``Delimiter="/"`` does against S3 -- and the count is bounded by the number of
runs rather than the number of objects, so this stays cheap. The per-catchment objects are
never listed here; DuckDB globs them at read time.

**A failure is not an empty list.** ``StorageUnreachable`` exists because the deleted
``datastream_utils.check_if_s3_file_exists`` swallowed every ClientError and returned False,
reporting "does not exist" for what was actually a 403. That was tolerable against a public
bucket. With real credentials it is a routine failure mode, and an empty picker is the least
actionable way to show it.
"""

import functools
import logging
import os
import posixpath

from . import duckdb_conn, manifest

logger = logging.getLogger(__name__)

# Overridable so a deployment can mount runs elsewhere, and so tests need no container.
MANAGED_ROOT_ENV = "NGIAB_MANAGED_ROOT"
DEFAULT_MANAGED_ROOT = "/var/lib/tethys_persist/ngiab_visualizer"

# The named entry in Django's STORAGES setting that addresses the run bucket. Only consulted
# when the backend is object storage; the local backend needs no configuration at all.
STORAGE_ALIAS = "ngiab_runs"

_NOT_INGESTED = "This directory has no manifest, so it has not been ingested yet."
_NO_OUTPUTS = "No catchment outputs in this run, so there is nothing to plot."
_UNREADABLE = "This run's manifest could not be read."


class StorageUnreachable(RuntimeError):
    """Raised when the storage backend itself fails, as distinct from holding no runs.

    Its own class so a caller can tell "the bucket refused us" from "there is nothing here",
    which are the same empty list otherwise.
    """


def local_root():
    """The filesystem directory holding run directories."""
    return os.environ.get(MANAGED_ROOT_ENV, DEFAULT_MANAGED_ROOT)


def _storage_for_backend():
    """The Django storage addressing the run root, chosen by the backend predicate.

    The local case builds a FileSystemStorage directly rather than reading a STORAGES entry,
    so a laptop deployment needs no settings change to keep working exactly as it does today.
    """
    from django.core.files.storage import FileSystemStorage, storages

    if duckdb_conn.is_object_storage():
        return storages[STORAGE_ALIAS]
    return FileSystemStorage(location=local_root())


def storage():
    """The configured storage for run data."""
    return _storage_for_backend()


def _bucket_uri():
    """The ``s3://bucket/prefix`` base for the configured object store.

    Built from the storage's own settings so there is one place the bucket is named. DuckDB
    cannot take a Django storage, only a URI, which is why this exists at all -- the storage
    interface covers reading small artefacts, and DuckDB covers reading the bulk.
    """
    backend = storage()
    bucket = getattr(backend, "bucket_name", None)
    if not bucket:
        raise StorageUnreachable(
            f"The {STORAGE_ALIAS!r} storage declares no bucket_name, so run locations cannot "
            "be addressed."
        )
    prefix = (getattr(backend, "location", "") or "").strip("/")
    return f"s3://{bucket}/{prefix}" if prefix else f"s3://{bucket}"


def location(name, *parts):
    """A location string DuckDB can read, for a path inside one run.

    A filesystem path locally, an ``s3://`` URI when hosted. The query text that consumes it
    does not vary -- ``read_parquet`` takes either -- which is what keeps the readers
    backend-agnostic.
    """
    if duckdb_conn.is_object_storage():
        return posixpath.join(_bucket_uri(), name, *parts)
    return os.path.join(local_root(), name, *parts)


def _read_manifest(name):
    """The hot manifest for one run, or None when it has none or cannot be read.

    Goes through the storage interface rather than ``manifest.read`` so the object-store path
    works: ``manifest.read`` opens a filesystem path, which does not exist in a bucket.
    """
    import json

    backend = storage()
    key = posixpath.join(name, manifest.MANIFEST_NAME)
    try:
        if not backend.exists(key):
            return None
        with backend.open(key) as handle:
            payload = handle.read()
    except Exception as exc:
        raise StorageUnreachable(str(exc)) from exc

    try:
        if isinstance(payload, bytes):
            payload = payload.decode("utf-8")
        return json.loads(payload)
    except (UnicodeDecodeError, ValueError) as exc:
        logger.warning("Could not parse the manifest for %s: %s", name, exc)
        return False


def _describe(name):
    """One run's listing entry: what it is, and if it is unusable, why.

    Reports rather than filters, following ``describe_importable_run``: a directory a user
    can see in the bucket and cannot see in the interface is indistinguishable from a bug.
    """
    document = _read_manifest(name)

    if document is False:
        return {"name": name, "manifest": None, "usable": False, "reason": _UNREADABLE}
    if document is None:
        return {"name": name, "manifest": None, "usable": False, "reason": _NOT_INGESTED}
    if not document.get("output_format"):
        return {"name": name, "manifest": document, "usable": False, "reason": _NO_OUTPUTS}
    return {"name": name, "manifest": document, "usable": True, "reason": None}


def _created_of(entry):
    return (entry.get("manifest") or {}).get("created") or ""


def _label_of(entry):
    return (entry.get("manifest") or {}).get("label") or entry["name"]


def _ordered(entries):
    """Newest first, then by label, reproducing ModelRun.Meta.ordering = ["-created", "label"].

    A storage listing is lexicographic, so without this the run picker reorders and a
    different run loads by default on every fresh visit. ``created`` is captured at ingest
    precisely because an object-store prefix has no creation time of its own; a run lacking
    one sorts last, since the empty string is smallest and this sort is reversed.

    Two stable passes rather than one composite key: the two fields sort in opposite
    directions, and the arithmetic that expresses that in a single tuple is unreadable.
    """
    by_label = sorted(entries, key=_label_of)
    return sorted(by_label, key=_created_of, reverse=True)


@functools.lru_cache(maxsize=1)
def _cached_listing(root_key):
    backend = storage()
    try:
        directories, _files = backend.listdir("")
    except FileNotFoundError:
        # A root that does not exist yet is a fresh install, not a failure.
        return ()
    except StorageUnreachable:
        raise
    except Exception as exc:
        raise StorageUnreachable(f"Could not list runs at {root_key}: {exc}") from exc

    return tuple(_ordered([_describe(name) for name in directories]))


def list_runs():
    """Every run under the storage root, newest first, unusable ones included.

    Cached: ``_get_list_model_runs`` is reached at least twice per data request, so an
    uncached listing is two storage round trips before an endpoint does any work of its own.
    The cache is dropped by ``clear_caches``, which ingest and removal both call.
    """
    return [dict(entry) for entry in _cached_listing(_root_key())]


def find(name):
    """One run's entry by name, or None."""
    for entry in list_runs():
        if entry["name"] == name:
            return entry
    return None


def _root_key():
    """Identifies the current root, so a backend switch does not serve a stale listing.

    Deliberately not _bucket_uri(): that raises when the bucket is unconfigured, and a cache
    key has no business failing. It reads whatever the backend can tell it and falls back to
    the backend's identity.
    """
    if not duckdb_conn.is_object_storage():
        return local_root()
    backend = storage()
    bucket = getattr(backend, "bucket_name", None)
    prefix = getattr(backend, "location", "") or ""
    return f"{bucket or type(backend).__name__}/{prefix}"


def clear_caches():
    """Drop the cached listing. Called after ingest, after removal, and by tests."""
    _cached_listing.cache_clear()
    manifest.clear_caches()
