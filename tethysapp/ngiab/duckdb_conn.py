"""One configured DuckDB connection for the whole app.

Three modules reached DuckDB three different ways before this: ``utils.py`` through the
module-level default connection (``duckdb.query``), ``teehr_evaluation.py`` through a bare
``duckdb.connect()``, and only ``teehr_warehouse.py`` through a connection that actually
configured itself. That was survivable while every read was a local file. It stops being
survivable when reads may address object storage, because ``httpfs`` has to be loaded and
credentials have to be supplied, and a caller that skips the setup fails at query time with
an error that points at the query rather than the connection.

**Extensions are installed at image build time and only loaded here.** The extension
directory is read-only at runtime and the container has no reason to reach
``extensions.duckdb.org``, so ``autoinstall_known_extensions`` and
``autoload_known_extensions`` are both turned off: a missing extension should fail loudly
and immediately rather than hang on a network fetch that cannot succeed. This has bitten the
project once already -- DuckDB's iceberg extension autoloading ``avro`` on first use is why
``avro`` is in the Dockerfile's install list.

**Concurrency.** Callers get a ``cursor()`` off one configured connection, not a connection
of their own. Measured in the image: a fresh configured connection costs 7.5 ms, or 21.3 ms
once ``httpfs`` is loaded, against 0.005 ms for a cursor -- and a parquet catchment read is
about 9 ms, so per-request connections would more than double the cheapest endpoint. Cursors
are separate handles and safe to use from different threads (verified under 16 concurrent
threads), but queries issued through them **serialize on the underlying connection**;
``cursor()`` is isolation, not parallelism. That is what ``duckdb.query`` already did, so
this is not a regression -- but if serialization ever becomes the bottleneck the answer is a
small pool of configured connections, not more cursors. Intra-query parallelism is
unaffected and still governed by DuckDB's own ``threads`` setting.
"""

import functools
import logging
import os

import duckdb

logger = logging.getLogger(__name__)

# Matches the path the Dockerfile and apptainer/ngiab.def install into. The previous default
# in teehr_warehouse.py pointed at /usr/lib/tethys/duckdb_extensions, which does not exist in
# the image -- it worked only because DUCKDB_HOME is always set, and would have failed in any
# process that lost the variable.
DEFAULT_DUCKDB_HOME = "/opt/duckdb_extensions"

# Loaded for every connection. sqlite and iceberg are what the TEEHR warehouse reader needs;
# avro is pulled in by iceberg at query time and is listed so it never autoloads.
_BASE_EXTENSIONS = ("sqlite", "iceberg", "avro")

# Loaded only against object storage. aws travels with httpfs because PROVIDER
# credential_chain autoloads it over the network otherwise, which fails offline.
_OBJECT_STORAGE_EXTENSIONS = ("httpfs", "aws")

STORAGE_BACKEND_ENV = "NGIAB_STORAGE_BACKEND"


def storage_backend():
    """Which storage backend this deployment reads runs from: ``"local"`` or ``"s3"``.

    Defined here rather than alongside the run store because the connection factory is the
    first thing that needs it -- whether to load httpfs is a connection-time decision. The
    run store consumes the same predicate so the two cannot disagree about which backend is
    in play.

    Anything other than ``s3`` is local, deliberately: an unset or misspelled value should
    leave a deployment on the behaviour it has today rather than silently reaching for a
    bucket it has no credentials for.
    """
    return "s3" if os.environ.get(STORAGE_BACKEND_ENV, "").strip().lower() == "s3" else "local"


def is_object_storage():
    """True when runs are addressed as ``s3://`` URIs rather than filesystem paths."""
    return storage_backend() == "s3"


def duckdb_home():
    """The directory holding the extensions the image installed at build time."""
    return os.environ.get("DUCKDB_HOME", DEFAULT_DUCKDB_HOME)


def quote(value):
    """Return ``value`` as a SQL string literal, quotes included and internal quotes doubled.

    Returns the surrounding quotes rather than just the escaped body, because the failure
    mode this exists to prevent is a caller that escapes and then forgets to quote, or quotes
    and forgets to escape. There is one correct way to interpolate a path and this is it.

    Only ``_output_glob`` escaped before. Every other interpolation site took the path raw,
    which was safe only because paths came from operator-controlled directory scans. Once a
    path can be derived from a user-supplied archive's realization.json, it is input.
    """
    return "'" + str(value).replace("'", "''") + "'"


def _configure(connection):
    """Apply the settings every connection needs, in the order DuckDB requires them."""
    home = duckdb_home()
    connection.execute(f"SET extension_directory={quote(home)}")
    connection.execute(f"SET home_directory={quote(home)}")
    connection.execute("SET autoinstall_known_extensions=false")
    connection.execute("SET autoload_known_extensions=false")

    extensions = list(_BASE_EXTENSIONS)
    if is_object_storage():
        extensions.extend(_OBJECT_STORAGE_EXTENSIONS)

    for extension in extensions:
        try:
            connection.execute(f"LOAD {extension}")
        except duckdb.Error as exc:
            raise ExtensionUnavailable(
                f"DuckDB extension {extension!r} could not be loaded from {home}. "
                "Extensions are installed at image build time; a missing one means the image "
                "and the DuckDB version have drifted apart."
            ) from exc
    return connection


class ExtensionUnavailable(RuntimeError):
    """Raised when a required DuckDB extension is not present in the extension directory.

    Its own class because the remedy is a rebuild, not a retry, and the caller should not
    confuse it with a query error.
    """


@functools.lru_cache(maxsize=1)
def _base_connection():
    """The one configured connection, created on first use.

    lru_cache rather than a module-level constant so that importing this module does not
    open a connection -- Django imports it during app loading, and a connection opened there
    would outlive nothing useful and fail the import if the extension directory were absent.
    """
    logger.debug("opening the DuckDB connection (backend=%s)", storage_backend())
    return _configure(duckdb.connect())


def connect():
    """A cursor on the shared configured connection.

    Callers should treat the result as their own handle and close it when finished. See the
    module docstring for why this is a cursor rather than a connection.
    """
    return _base_connection().cursor()


def connect_isolated():
    """A fresh configured connection with a catalog of its own.

    For callers that ``ATTACH``. A cursor shares the underlying connection's catalog, so two
    readers attaching under the same alias would collide -- the TEEHR warehouse reader
    attaches its SQLite catalog as ``cat``, and two of those must not see each other. Pays
    the full setup cost (7.5 ms, 21.3 ms with httpfs), which is why it is not the default.

    The caller owns the result and must close it.
    """
    return _configure(duckdb.connect(":memory:"))


def query(sql, parameters=None):
    """Run one statement on a short-lived cursor and return the relation's DataFrame.

    The common shape in utils.py, which reads a result and discards the handle.
    """
    cursor = connect()
    try:
        return cursor.execute(sql, parameters or []).df()
    finally:
        cursor.close()


def fetchone(sql, parameters=None):
    """Run one statement and return its first row, or None."""
    cursor = connect()
    try:
        return cursor.execute(sql, parameters or []).fetchone()
    finally:
        cursor.close()


def reset():
    """Drop the cached connection. Tests only."""
    _base_connection.cache_clear()
