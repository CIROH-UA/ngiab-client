"""One configured DuckDB connection for the whole app.

Loads extensions and sets up credentials once, so callers just get a cursor.
"""

import functools
import logging
import os

import duckdb

logger = logging.getLogger(__name__)

DEFAULT_DUCKDB_HOME = "/opt/duckdb_extensions"

_BASE_EXTENSIONS = ()

_OBJECT_STORAGE_EXTENSIONS = ("httpfs", "aws")

STORAGE_BACKEND_ENV = "NGIAB_STORAGE_BACKEND"


def storage_backend():
    """Which storage backend this deployment reads runs from: ``"local"`` or ``"s3"``."""
    return "s3" if os.environ.get(STORAGE_BACKEND_ENV, "").strip().lower() == "s3" else "local"


def is_object_storage():
    """True when runs are addressed as ``s3://`` URIs rather than filesystem paths."""
    return storage_backend() == "s3"


def duckdb_home():
    """The directory holding the extensions the image installed at build time."""
    return os.environ.get("DUCKDB_HOME", DEFAULT_DUCKDB_HOME)


def quote(value):
    """Return ``value`` as a SQL string literal, quotes included and internal quotes doubled."""
    return "'" + str(value).replace("'", "''") + "'"


def quote_identifier(name):
    """Return ``name`` as a SQL identifier, double quotes included and internal ones doubled."""
    return '"' + str(name).replace('"', '""') + '"'


def is_missing_error(exc):
    """Whether a failed read means the object is not there, rather than unreachable."""
    status = getattr(exc, "status_code", None)
    if status is not None:
        return status == 404
    return "no files found" in str(exc).lower()


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

    if is_object_storage():
        _authenticate(connection)
    return connection


def _authenticate(connection):
    """Give the connection credentials for the run bucket."""
    from . import run_store

    try:
        statement = run_store.duckdb_secret_sql()
    except Exception:  # noqa: BLE001 - reported on use, where the caller can act on it
        logger.warning(
            "Could not build S3 credentials for DuckDB; reads of run data will fail",
            exc_info=True,
        )
        return

    if not statement:
        return
    try:
        connection.execute(statement)
    except duckdb.Error:
        logger.warning("DuckDB refused the S3 credentials for the run bucket", exc_info=True)


class ExtensionUnavailable(RuntimeError):
    """Raised when a required DuckDB extension is not present in the extension directory."""


@functools.lru_cache(maxsize=1)
def _base_connection():
    """The one configured connection, created on first use."""
    logger.debug("opening the DuckDB connection (backend=%s)", storage_backend())
    return _configure(duckdb.connect())


def connect():
    """A cursor on the shared configured connection."""
    return _base_connection().cursor()


def connect_isolated():
    """A fresh configured connection with a catalog of its own, for callers that ``ATTACH``."""
    return _configure(duckdb.connect(":memory:"))


def query(sql, parameters=None):
    """Run one statement on a short-lived cursor and return the relation's DataFrame."""
    return _with_fresh_credentials(lambda: _query_once(sql, parameters))


def _query_once(sql, parameters=None):
    cursor = connect()
    try:
        return cursor.execute(sql, parameters or []).df()
    finally:
        cursor.close()


_AUTH_FAILURE_MARKERS = (
    "http 401", "http 403", "expiredtoken", "invalidaccesskeyid",
    "signaturedoesnotmatch", "access denied",
)


def _with_fresh_credentials(run):
    """Run a query, and retry it once against a rebuilt connection on an auth failure."""
    try:
        return run()
    except duckdb.Error as exc:
        if not is_object_storage():
            raise
        message = str(exc).lower()
        if not any(marker in message for marker in _AUTH_FAILURE_MARKERS):
            raise
        logger.info("Rebuilding the DuckDB connection after an S3 auth failure")
        reset()
        return run()


def fetchone(sql, parameters=None):
    """Run one statement and return its first row, or None."""
    return _with_fresh_credentials(lambda: _fetchone_once(sql, parameters))


def _fetchone_once(sql, parameters=None):
    cursor = connect()
    try:
        return cursor.execute(sql, parameters or []).fetchone()
    finally:
        cursor.close()


def reset():
    """Drop the cached connection, so the next caller builds a fresh one."""
    _base_connection.cache_clear()
