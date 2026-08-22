"""The shared DuckDB connection: configuration, extensions, and literal escaping.

Read docs/plans/2026-08-22-001-feat-storage-backed-model-runs-plan.md, Unit 2.

These run inside the image and assert against the extension directory the build actually
populated, rather than mocking DuckDB. The whole point of the unit is that the connection is
configured correctly in the environment that ships, and a mocked connection cannot tell us
that.
"""

import os

import duckdb
import pytest

from tethysapp.ngiab import duckdb_conn


@pytest.fixture(autouse=True)
def _fresh_connection():
    """Every test gets an unconfigured start, since the connection is cached per process."""
    duckdb_conn.reset()
    yield
    duckdb_conn.reset()


@pytest.fixture
def local_backend(monkeypatch):
    monkeypatch.delenv(duckdb_conn.STORAGE_BACKEND_ENV, raising=False)


@pytest.fixture
def s3_backend(monkeypatch):
    monkeypatch.setenv(duckdb_conn.STORAGE_BACKEND_ENV, "s3")


def _loaded_extensions(cursor):
    rows = cursor.execute(
        "SELECT extension_name FROM duckdb_extensions() WHERE loaded"
    ).fetchall()
    return {row[0] for row in rows}


# ---- Backend predicate -----------------------------------------------------


def test_backend_defaults_to_local(local_backend):
    assert duckdb_conn.storage_backend() == "local"
    assert duckdb_conn.is_object_storage() is False


def test_backend_reads_s3_case_insensitively(monkeypatch):
    monkeypatch.setenv(duckdb_conn.STORAGE_BACKEND_ENV, "  S3 ")
    assert duckdb_conn.is_object_storage() is True


def test_unrecognised_backend_stays_local(monkeypatch):
    """A misspelling must not silently reach for a bucket this deployment cannot reach."""
    monkeypatch.setenv(duckdb_conn.STORAGE_BACKEND_ENV, "s33")
    assert duckdb_conn.storage_backend() == "local"


# ---- Extensions ------------------------------------------------------------


def test_local_backend_does_not_load_httpfs(local_backend):
    cursor = duckdb_conn.connect()
    try:
        loaded = _loaded_extensions(cursor)
    finally:
        cursor.close()
    assert "httpfs" not in loaded
    assert {"sqlite_scanner", "iceberg"} <= loaded


def test_object_storage_backend_loads_httpfs_and_aws(s3_backend):
    """httpfs alone is not enough: credential_chain autoloads aws over the network."""
    cursor = duckdb_conn.connect()
    try:
        loaded = _loaded_extensions(cursor)
    finally:
        cursor.close()
    assert {"httpfs", "aws"} <= loaded


def test_autoinstall_is_disabled(local_backend):
    """A missing extension must fail loudly, not reach for extensions.duckdb.org.

    The container has no route to the extension repository and the extension directory is
    read-only, so an autoinstall attempt is a hang followed by a confusing error.
    """
    cursor = duckdb_conn.connect()
    try:
        autoinstall = cursor.execute(
            "SELECT current_setting('autoinstall_known_extensions')"
        ).fetchone()[0]
        autoload = cursor.execute(
            "SELECT current_setting('autoload_known_extensions')"
        ).fetchone()[0]
    finally:
        cursor.close()
    assert autoinstall is False
    assert autoload is False


def test_missing_extension_directory_raises_extension_unavailable(monkeypatch, tmp_path):
    """The failure names the connection, not the query that happened to run first."""
    monkeypatch.setenv("DUCKDB_HOME", str(tmp_path / "nowhere"))
    duckdb_conn.reset()
    with pytest.raises(duckdb_conn.ExtensionUnavailable) as excinfo:
        duckdb_conn.connect()
    assert "installed at image build time" in str(excinfo.value)


def test_default_extension_home_matches_the_image(monkeypatch):
    """The fallback has to be the path the build actually installs into.

    It previously pointed at /usr/lib/tethys/duckdb_extensions, which does not exist in the
    image. That was invisible because DUCKDB_HOME is always set in the container -- and would
    have surfaced in the first process that lost the variable.
    """
    monkeypatch.delenv("DUCKDB_HOME", raising=False)
    assert duckdb_conn.duckdb_home() == duckdb_conn.DEFAULT_DUCKDB_HOME
    assert os.path.isdir(duckdb_conn.DEFAULT_DUCKDB_HOME)


# ---- Literal escaping ------------------------------------------------------


def test_quote_wraps_and_doubles_internal_quotes():
    assert duckdb_conn.quote("/runs/plain") == "'/runs/plain'"
    assert duckdb_conn.quote("/runs/o'brien") == "'/runs/o''brien'"


def test_quote_neutralises_a_statement_break_attempt(local_backend, tmp_path):
    """A path crafted to close the literal and append SQL stays one literal.

    Not theoretical from Unit 5 onward: the output directory is read out of a run's
    realization.json, which in the hosted deployment arrives inside a user-supplied archive.
    """
    hostile = "/runs/x'; SELECT 42; --"
    cursor = duckdb_conn.connect()
    try:
        value = cursor.execute(f"SELECT {duckdb_conn.quote(hostile)}").fetchone()[0]
    finally:
        cursor.close()
    assert value == hostile


def test_quoted_path_survives_a_real_read(local_backend, tmp_path):
    """A directory with a quote in its name reads back correctly through the factory."""
    awkward = tmp_path / "o'brien run"
    awkward.mkdir()
    csv_path = awkward / "cat-100.csv"
    csv_path.write_text("Time Step,Time,Q_OUT\n0,2017-01-01 00:00:00,1.5\n")

    frame = duckdb_conn.query(
        f"SELECT * FROM read_csv_auto({duckdb_conn.quote(str(csv_path))})"
    )
    assert frame["Q_OUT"].tolist() == [1.5]


# ---- Connection behaviour --------------------------------------------------


def test_connect_returns_independent_cursors(local_backend):
    """Separate handles, so one caller closing does not disturb another."""
    first = duckdb_conn.connect()
    second = duckdb_conn.connect()
    try:
        assert first is not second
        first.close()
        assert second.execute("SELECT 1").fetchone()[0] == 1
    finally:
        second.close()


def test_the_connection_is_shared_not_reopened(local_backend, mocker):
    """Setup is paid once. A fresh configured connection costs 7.5 ms, 21.3 ms with httpfs."""
    spy = mocker.spy(duckdb, "connect")
    for _ in range(5):
        duckdb_conn.connect().close()
    assert spy.call_count == 1


# ---- The five call sites that never escaped, driven for real -----------------


@pytest.fixture
def awkward_run(ingest):
    """A run whose directory name contains a single quote, in both output formats.

    Every interpolation site below took its path raw before this unit. That was safe only
    because paths came from operator-controlled directory scans. From Unit 5 the output
    directory is read out of a run's realization.json, which in the hosted deployment arrives
    inside a user-supplied archive -- so these become input-handling paths, and a quote in a
    directory name is the mildest thing that can appear in one.
    """
    return ingest("o'brien run", output_format="both")


@pytest.fixture
def awkward_run_id(awkward_run):
    """The run name is the directory name, so the quote is in the id too."""
    return awkward_run


def test_read_output_columns_survives_a_quoted_path(awkward_run, awkward_run_id):
    """_read_output_columns, utils.py -- read_parquet(...) LIMIT 0."""
    from tethysapp.ngiab import utils as ngiab_utils

    columns = ngiab_utils._read_output_columns(
        ngiab_utils.run_outputs(awkward_run_id), "cat-100"
    )
    assert columns[:2] == ["Time Step", "Time"]


def test_read_output_frame_survives_a_quoted_path(awkward_run, awkward_run_id):
    """_read_output_frame, utils.py -- the projected read behind every catchment chart."""
    from tethysapp.ngiab import utils as ngiab_utils

    frame = ngiab_utils._read_output_frame(
        ngiab_utils.run_outputs(awkward_run_id), "cat-100", ["Time", "Q_OUT"], time_column="Time"
    )
    assert len(frame) == 6
    assert frame["Time"].iloc[0] == "2017-01-01 00:00:00"


def test_union_columns_survives_a_quoted_path(awkward_run, awkward_run_id):
    """_output_glob into _union_columns -- the only site that escaped before, kept honest."""
    from tethysapp.ngiab import utils as ngiab_utils

    variables = ngiab_utils.get_catchment_variables(awkward_run_id)
    assert variables["variables"] == ["RAIN_RATE", "Q_OUT", "SOIL_STORAGE"]


def test_value_matrix_survives_a_quoted_path(awkward_run, awkward_run_id):
    """_build_value_matrix -- two interpolations, the extent probe and the grouped scan."""
    from tethysapp.ngiab import utils as ngiab_utils

    matrix = ngiab_utils.get_catchment_value_matrix(awkward_run_id, "Q_OUT")
    assert matrix["variable"] == "Q_OUT"
    assert matrix["catchment_ids"] == [100, 101, 102]
    assert len(matrix["times"]) == 6


def test_warehouse_attach_path_is_quoted(tmp_path):
    """teehr_warehouse ATTACHes a catalog path that used to be interpolated raw."""
    from tethysapp.ngiab import teehr_warehouse

    warehouse = tmp_path / "o'brien warehouse"
    (warehouse / "local").mkdir(parents=True)
    (warehouse / "local" / "version").write_text("0.6.2")

    # No catalog file, so this must fail as unreachable -- not as a SQL syntax error.
    with pytest.raises(teehr_warehouse.WarehouseUnreachable):
        teehr_warehouse.WarehouseReader(str(warehouse))
