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
import time

from . import duckdb_conn, manifest

logger = logging.getLogger(__name__)

# Overridable so a deployment can mount runs elsewhere, and so tests need no container.
MANAGED_ROOT_ENV = "NGIAB_MANAGED_ROOT"
DEFAULT_MANAGED_ROOT = "/var/lib/tethys_persist/ngiab_visualizer"

# The named entry in Django's STORAGES setting that addresses the run bucket. Only consulted
# when the backend is object storage; the local backend needs no configuration at all.
STORAGE_ALIAS = "ngiab_runs"

# How long a listing may be stale. See _time_bucket for why this is a window rather than an
# invalidation signal, and why 10 seconds.
LISTING_TTL_ENV = "NGIAB_LISTING_TTL_SECONDS"
DEFAULT_LISTING_TTL_SECONDS = 10.0

_NOT_INGESTED = "This directory has no manifest, so it has not been ingested yet."
_NO_OUTPUTS = "No catchment outputs in this run, so there is nothing to plot."
_UNREADABLE = "This run's manifest could not be read."
_UNSUPPORTED_SCHEMA = (
    "This run's manifest uses schema version {found}, which this version of the visualizer "
    "does not understand (it reads up to {supported})."
)


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

    A manifest from a newer writer is unusable rather than fatal. One run written by a later
    image should degrade on its own, not take the portal's entire run list with it -- and
    reading it as if it were this schema would be worse than refusing, because the fields
    would be plausible and wrong.
    """
    document = _read_manifest(name)

    if document is False:
        return {"name": name, "manifest": None, "usable": False, "reason": _UNREADABLE}
    if document is None:
        return {"name": name, "manifest": None, "usable": False, "reason": _NOT_INGESTED}

    version = document.get("schema_version")
    if not isinstance(version, int) or version > manifest.SCHEMA_VERSION:
        return {
            "name": name,
            "manifest": document,
            "usable": False,
            "reason": _UNSUPPORTED_SCHEMA.format(
                found=version, supported=manifest.SCHEMA_VERSION
            ),
        }

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


def listing_ttl_seconds():
    """Seconds a cached listing may be stale. Zero disables caching."""
    try:
        return max(float(os.environ.get(LISTING_TTL_ENV, DEFAULT_LISTING_TTL_SECONDS)), 0.0)
    except ValueError:
        return DEFAULT_LISTING_TTL_SECONDS


def _time_bucket():
    """A value that changes once per TTL window, used as part of the cache key.

    A time window rather than an invalidation signal, because there is nothing to signal on.
    The obvious key would be each run's version token -- but the token lives *inside* the
    manifest the cache exists to avoid fetching, so learning it changed costs exactly the
    round trips being saved. That circularity is why the plan's "a newly ready run appears
    without a restart" could not be implemented as written.

    A window resolves it and, usefully, also resolves the cross-process problem: several
    uvicorn workers each hold their own cache with no channel between them, but all of them
    converge within one TTL, so worker count stops mattering. An event-based scheme would
    have needed a shared bus to achieve the same thing.

    Ten seconds because the cost it bounds is small and the delay it imposes is felt. At the
    default a hosted deployment does one LIST plus one GET per run per ten seconds no matter
    the request rate, and an operator who drops a directory into the root waits at most ten
    seconds to see it -- against today, where a copied directory never appears until someone
    clicks "Add a run".
    """
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
    return [dict(entry) for entry in _cached_listing(_root_key(), _time_bucket())]


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


def delete(name):
    """Remove one run and everything under it. Irreversible.

    Takes a run *name*, never a path, and refuses any name the listing did not just return.
    That is the same invariant the old importer enforced from the other direction -- it
    accepted a path only if a fresh scan would offer that exact path, verified against
    ``../..`` and symlinks planted inside the root. Resolving the name through the listing
    means a caller cannot describe a directory of its own choosing at all, so there is no
    traversal to defend against.

    This reverses a deliberate decision: the app previously contained no ``os.remove`` at
    all, because unregistering a run that the user could not re-add was judged too much
    damage for a tidy-up action. It is reversed knowingly -- with the listing derived from
    storage, a removal that does not delete cannot work, because the run reappears on the
    next scan. That resurrection is a bug this project already shipped once, under the JSON
    registry, where deleting the sole run brought it back on the next request.
    """
    import shutil

    if not _is_plain_name(name) or find(name) is None:
        raise LookupError(name)

    if duckdb_conn.is_object_storage():
        _delete_prefix(storage(), name)
    else:
        shutil.rmtree(_contained_directory(name))

    clear_caches()


def _is_plain_name(name):
    """A run name is one path component. Anything else is not a run being named."""
    return bool(name) and name not in (".", "..") and os.sep not in name and "/" not in name


def _contained_directory(name):
    """The run's real directory, or LookupError if it is not genuinely inside the root.

    ``find`` is not sufficient on its own: it reports *unusable* entries too, so a symlink
    sitting in the root comes back as an entry with a reason attached. Deleting through it
    would follow the link out of the storage root.

    This is the containment check ``is_scannable`` used to perform -- realpath on both sides,
    so neither ``..`` in a name nor a symlink planted inside the root can name a directory
    outside it. The importer that needed it is gone; the invariant is not. A symlink is
    refused outright rather than unlinked, because it is not a run.
    """
    root = os.path.realpath(local_root())
    target = os.path.join(root, name)
    if os.path.islink(target) or not os.path.isdir(target):
        raise LookupError(name)

    real = os.path.realpath(target)
    if real != root and not real.startswith(root + os.sep):
        raise LookupError(name)
    return real


def _delete_prefix(backend, prefix):
    """Delete every object under a prefix, depth first.

    Object stores have no directories to remove, only keys, so this enumerates and deletes
    rather than unlinking a tree.
    """
    directories, files = backend.listdir(prefix)
    for name in files:
        backend.delete(posixpath.join(prefix, name))
    for name in directories:
        _delete_prefix(backend, posixpath.join(prefix, name))


def clear_caches():
    """Drop the cached listing. Called after ingest, after removal, and by tests."""
    _cached_listing.cache_clear()
    manifest.clear_caches()
