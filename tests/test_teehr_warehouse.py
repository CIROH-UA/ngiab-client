"""Tests for tethysapp.ngiab.teehr_warehouse.WarehouseReader.

These tests run against a real TEEHR warehouse produced by ``ngiab-teehr``.
The warehouse location is taken from the ``TEEHR_TEST_WAREHOUSE`` environment
variable; tests are skipped if it is unset or the warehouse is not readable.

Produce a fixture warehouse once with::

    /home/aquagio/tethysdev/ciroh/ngen/ngiab-teehr/runTeehr.sh \\
        -d /home/aquagio/ngiab/ -t local

Then run tests::

    TEEHR_TEST_WAREHOUSE=/home/aquagio/ngiab pytest tests/test_teehr_warehouse.py
"""

import math
import os
import shutil
from pathlib import Path

import pytest

from tethysapp.ngiab.teehr_warehouse import (
    SUPPORTED_TEEHR_VERSIONS,
    UnsupportedWarehouseVersion,
    WarehouseReader,
    WarehouseUnreachable,
)
from tethysapp.ngiab import utils as ngiab_utils


WAREHOUSE_ENV = "TEEHR_TEST_WAREHOUSE"


@pytest.fixture(autouse=True, scope="session")
def _duckdb_home(tmp_path_factory):
    """Point DuckDB at a writable home/extension dir for local test runs.

    The reader module's default DUCKDB_HOME (/opt/duckdb_extensions) only
    exists inside the built Docker image. Tests running on a developer
    machine need a local alternative. Pre-install sqlite and iceberg into
    that dir once per session so LOAD in the reader works.
    """
    import duckdb
    home = tmp_path_factory.mktemp("duckdb_home")
    os.environ["DUCKDB_HOME"] = str(home)
    c = duckdb.connect(":memory:")
    c.execute(f"SET home_directory='{home}'")
    c.execute(f"SET extension_directory='{home}'")
    c.execute("INSTALL sqlite")
    c.execute("INSTALL iceberg")
    c.close()
    yield str(home)


def _fixture_path():
    path = os.environ.get(WAREHOUSE_ENV)
    if not path:
        pytest.skip(
            f"{WAREHOUSE_ENV} not set; point it at a warehouse produced by "
            "ngiab-teehr runTeehr.sh to enable these tests."
        )
    p = Path(path)
    if not (p / "local" / "local_catalog.db").exists():
        pytest.skip(f"No local/local_catalog.db under {p}")
    return p


@pytest.fixture
def warehouse_path():
    return _fixture_path()


@pytest.fixture
def reader(warehouse_path):
    with WarehouseReader(warehouse_path) as r:
        yield r


def _usgs_id_with_metrics(reader, config_name):
    """Pick a USGS id the warehouse has non-empty ngen_metrics rows for."""
    for usgs in reader.list_usgs_locations_for_run(config_name):
        if reader.get_metrics_for_location(config_name, usgs):
            return usgs
    pytest.skip(f"no USGS location with metrics in fixture warehouse for {config_name}")


# ---- Lifecycle / version check ------------------------------------------


def test_opens_real_warehouse(warehouse_path):
    """Happy path: opening a valid warehouse populates teehr_version."""
    with WarehouseReader(warehouse_path) as r:
        assert r.teehr_version is not None
        assert r.teehr_version in SUPPORTED_TEEHR_VERSIONS


def test_version_file_missing(tmp_path):
    """A warehouse without a version file raises UnsupportedWarehouseVersion."""
    local = tmp_path / "local"
    local.mkdir()
    (local / "local_catalog.db").touch()
    with pytest.raises(UnsupportedWarehouseVersion):
        WarehouseReader(tmp_path)


def test_version_out_of_range(tmp_path):
    """A version outside the supported range raises UnsupportedWarehouseVersion."""
    local = tmp_path / "local"
    local.mkdir()
    (local / "local_catalog.db").touch()
    (local / "version").write_text("0.7.0\n")
    with pytest.raises(UnsupportedWarehouseVersion):
        WarehouseReader(tmp_path)


def test_version_unparseable(tmp_path):
    """An unparseable version string raises UnsupportedWarehouseVersion."""
    local = tmp_path / "local"
    local.mkdir()
    (local / "local_catalog.db").touch()
    (local / "version").write_text("not-a-version\n")
    with pytest.raises(UnsupportedWarehouseVersion):
        WarehouseReader(tmp_path)


def test_warehouse_path_does_not_exist(tmp_path):
    """A nonexistent warehouse raises WarehouseUnreachable."""
    with pytest.raises(WarehouseUnreachable):
        WarehouseReader(tmp_path / "nowhere")


def test_context_manager_closes_connection(warehouse_path):
    """Exiting the context closes the DuckDB connection."""
    r = WarehouseReader(warehouse_path)
    with r:
        assert r._conn is not None
    assert r._conn is None


def test_two_readers_are_independent(warehouse_path, tmp_path):
    """Two readers against the same warehouse get isolated connections."""
    # Simulate a second warehouse by copying the real one to a temp path.
    other = tmp_path / "warehouse_copy"
    shutil.copytree(warehouse_path / "local", other / "local")
    with WarehouseReader(warehouse_path) as a, WarehouseReader(other) as b:
        assert a._conn is not b._conn
        # Both work independently.
        assert a.list_configurations_for_run("nwm30_retrospective") is not None
        assert b.list_configurations_for_run("nwm30_retrospective") is not None
    # Closing one must not affect the other (already closed by __exit__).


# ---- configuration_exists -----------------------------------------------


def test_configuration_exists_for_real_config(reader):
    """nwm30_retrospective is always present in any warehouse teehr writes."""
    assert reader.configuration_exists("nwm30_retrospective") is True


def test_configuration_exists_returns_false_for_missing(reader):
    assert reader.configuration_exists("ngen_definitely_not_a_real_run_xyz") is False


# ---- list_configurations_for_run ----------------------------------------


def test_list_configurations_scoped_to_run(reader):
    """Should return entries only for the named run + nwm30_retrospective."""
    # The fixture warehouse was built with --data_folder_stem ngiab.
    result = reader.list_configurations_for_run("ngen_ngiab")
    assert result, "expected at least the two scoped configurations"
    configs = {entry["value"].split("-")[0] for entry in result}
    assert configs == {"ngen_ngiab", "nwm30_retrospective"}, (
        f"unexpected configurations surfaced: {configs}"
    )
    # Each entry should have both 'value' and 'label' keys (React contract).
    for entry in result:
        assert set(entry.keys()) == {"value", "label"}


def test_list_configurations_for_unknown_run_is_empty(reader):
    """Returns [] for a run whose configuration does not exist in the warehouse."""
    assert reader.list_configurations_for_run("ngen_not_real") == []


# ---- list_usgs_locations_for_run / usgs_for_ngen ------------------------


def test_list_usgs_locations_returns_primary_ids(reader):
    ids = reader.list_usgs_locations_for_run("ngen_ngiab")
    # Every returned id should start with usgs-
    assert ids
    assert all(i.startswith("usgs-") for i in ids)


def test_usgs_for_ngen_unknown_returns_none(reader):
    assert reader.usgs_for_ngen("ngen_ngiab", "ngen-0000000") is None


def test_list_crosswalks_returns_all_pairs(reader):
    pairs = reader.list_crosswalks()
    assert pairs, "expected at least one crosswalk row"
    for primary, secondary in pairs:
        assert primary.startswith("usgs-")
        assert "-" in secondary


def test_list_crosswalks_prefix_filter(reader):
    ngen_pairs = reader.list_crosswalks(secondary_prefix="ngen")
    nwm_pairs = reader.list_crosswalks(secondary_prefix="nwm30")
    assert all(p[1].startswith("ngen-") for p in ngen_pairs)
    assert all(p[1].startswith("nwm30-") for p in nwm_pairs)


# ---- utils.py integration helpers ---------------------------------------


def test_sanitize_stem_rules():
    assert ngiab_utils._sanitize_stem("AWI_16_2863657_007") == "awi_16_2863657_007"
    assert ngiab_utils._sanitize_stem("my-run.v2") == "my_run_v2"
    assert ngiab_utils._sanitize_stem("PLAIN") == "plain"


def test_detect_legacy_teehr_layout_false_when_run_missing(tmp_path, monkeypatch):
    """Unknown run id -> False, not an exception."""
    monkeypatch.setattr(
        ngiab_utils, "_get_list_model_runs", lambda: {"model_runs": []}
    )
    assert ngiab_utils._detect_legacy_teehr_layout("does-not-exist") is False


def test_detect_legacy_teehr_layout_true_when_metrics_csv_present(tmp_path, monkeypatch):
    run_dir = tmp_path / "run_A"
    (run_dir / "teehr").mkdir(parents=True)
    (run_dir / "teehr" / "metrics.csv").write_text("metric,primary_location_id\n")
    monkeypatch.setattr(
        ngiab_utils,
        "_get_list_model_runs",
        lambda: {"model_runs": [{"id": "run_A", "path": str(run_dir)}]},
    )
    assert ngiab_utils._detect_legacy_teehr_layout("run_A") is True


def test_resolve_configuration_name_prefers_manifest_field(monkeypatch):
    """Persisted teehr_configuration_name wins over derivation."""
    monkeypatch.setattr(
        ngiab_utils,
        "_get_list_model_runs",
        lambda: {
            "model_runs": [
                {
                    "id": "my_run",
                    "path": "/data/renamed_dir",
                    "teehr_configuration_name": "ngen_original_stem",
                }
            ]
        },
    )
    assert ngiab_utils._resolve_configuration_name("my_run") == "ngen_original_stem"


def test_resolve_configuration_name_falls_back_to_derivation(
    warehouse_path, monkeypatch
):
    """With no persisted field, derive from basename and validate via warehouse."""
    monkeypatch.setenv("TEEHR_WAREHOUSE_PATH", str(warehouse_path))
    monkeypatch.setattr(
        ngiab_utils,
        "_get_list_model_runs",
        lambda: {
            "model_runs": [
                {"id": "my_run", "path": "/home/aquagio/ngiab"}
            ]
        },
    )
    # Fixture warehouse was built with --data_folder_stem ngiab.
    assert ngiab_utils._resolve_configuration_name("my_run") == "ngen_ngiab"


def test_resolve_configuration_name_fallback_returns_none_when_derivation_misses(
    warehouse_path, monkeypatch
):
    """Fallback that derives a nonexistent config name returns None (not a false match)."""
    monkeypatch.setenv("TEEHR_WAREHOUSE_PATH", str(warehouse_path))
    monkeypatch.setattr(
        ngiab_utils,
        "_get_list_model_runs",
        lambda: {
            "model_runs": [
                {"id": "my_run", "path": "/somewhere/different_basename"}
            ]
        },
    )
    assert ngiab_utils._resolve_configuration_name("my_run") is None


def test_resolve_configuration_name_unknown_run_id_returns_none(monkeypatch):
    monkeypatch.setattr(
        ngiab_utils, "_get_list_model_runs", lambda: {"model_runs": []}
    )
    assert ngiab_utils._resolve_configuration_name("nothing") is None


# ---- get_metrics_for_location -------------------------------------------


def test_get_metrics_for_location_pivoted_shape(reader):
    """Row-per-metric shape with one column per configuration."""
    loc = _usgs_id_with_metrics(reader, "ngen_ngiab")
    metrics = reader.get_metrics_for_location("ngen_ngiab", loc)
    assert metrics, "expected at least 4 metric rows"
    metric_names = {row["metric"] for row in metrics}
    assert metric_names == {
        "root_mean_standard_deviation_ratio",
        "relative_bias",
        "nash_sutcliffe_efficiency",
        "kling_gupta_efficiency",
    }
    # Every row must at least have an ngen_ngiab key (nwm30_retrospective
    # is expected but may be absent if warehouse data is partial).
    for row in metrics:
        assert "ngen_ngiab" in row


def test_get_metrics_for_location_unknown_location_returns_empty(reader):
    assert reader.get_metrics_for_location("ngen_ngiab", "usgs-not-real") == []


# ---- get_joined_timeseries (drift guard) --------------------------------


def test_get_joined_timeseries_unknown_location(reader):
    """Unknown location returns []; no crash."""
    assert (
        reader.get_joined_timeseries(
            "ngen_ngiab", "streamflow_hourly_inst", "usgs-not-real"
        )
        == []
    )


def test_get_joined_timeseries_returns_two_series(reader):
    """Known location returns a USGS series and a secondary series, paired by time."""
    # list_usgs_locations_for_run returns every USGS id in the crosswalk for
    # the run, including gauges that have no USGS observations. For this test
    # we want one we know has data: pull from ngen_metrics (which is only
    # populated for gauges with complete observation coverage).
    loc = _usgs_id_with_metrics(reader, "ngen_ngiab")
    series = reader.get_joined_timeseries(
        "ngen_ngiab", "streamflow_hourly_inst", loc
    )
    assert len(series) == 2
    assert series[0]["label"] == "USGS"
    assert series[1]["label"].lower().startswith("ngen")
    # Both series have the same number of points (inner join).
    assert len(series[0]["data"]) == len(series[1]["data"])
    assert series[0]["data"], "expected at least one joined point"
    # Each point has x/y keys.
    for s in series:
        for pt in s["data"]:
            assert set(pt.keys()) == {"x", "y"}


# ---- Drift guard: recompute metrics from our join and compare ----------

# Tolerance rationale: Spark (teehr side) and DuckDB + pandas (our side) accumulate
# floating-point sums in different orders. Empirically, KGE and NSE drift by
# 1e-5 to 1e-4 on timeseries of this size. We set rtol=1e-3 / atol=1e-5 to stay
# well above noise while still catching semantic drift (wrong join, dropped rows).
METRIC_RTOL = 1e-3
METRIC_ATOL = 1e-5


def _relative_bias(primary, secondary):
    s = sum(secondary)
    p = sum(primary)
    return (s - p) / p


def _nash_sutcliffe(primary, secondary):
    mean_p = sum(primary) / len(primary)
    num = sum((s - p) ** 2 for s, p in zip(secondary, primary))
    den = sum((p - mean_p) ** 2 for p in primary)
    return 1 - num / den


def _pearson(primary, secondary):
    n = len(primary)
    mean_p = sum(primary) / n
    mean_s = sum(secondary) / n
    num = sum((p - mean_p) * (s - mean_s) for p, s in zip(primary, secondary))
    den_p = math.sqrt(sum((p - mean_p) ** 2 for p in primary))
    den_s = math.sqrt(sum((s - mean_s) ** 2 for s in secondary))
    return num / (den_p * den_s)


def _kling_gupta(primary, secondary):
    n = len(primary)
    mean_p = sum(primary) / n
    mean_s = sum(secondary) / n
    std_p = math.sqrt(sum((p - mean_p) ** 2 for p in primary) / n)
    std_s = math.sqrt(sum((s - mean_s) ** 2 for s in secondary) / n)
    r = _pearson(primary, secondary)
    alpha = std_s / std_p
    beta = mean_s / mean_p
    return 1 - math.sqrt((r - 1) ** 2 + (alpha - 1) ** 2 + (beta - 1) ** 2)


def _root_mean_standard_deviation_ratio(primary, secondary):
    n = len(primary)
    mean_p = sum(primary) / n
    std_p = math.sqrt(sum((p - mean_p) ** 2 for p in primary) / n)
    rmse = math.sqrt(sum((s - p) ** 2 for s, p in zip(secondary, primary)) / n)
    return rmse / std_p


def test_joined_timeseries_matches_ngen_metrics_drift_guard(reader):
    """Integration / drift guard (plan OD2).

    Recompute the four metrics from our DuckDB join and assert they match the
    ngen_metrics table that teehr itself wrote. This is the oracle for
    get_joined_timeseries -- any semantic drift between our join and teehr's
    joined_timeseries_view() will surface here.
    """
    loc = _usgs_id_with_metrics(reader, "ngen_ngiab")

    # Authoritative: teehr-computed metrics in ngen_metrics.
    teehr_metrics = reader.get_metrics_for_location("ngen_ngiab", loc)
    by_name = {row["metric"]: row for row in teehr_metrics}
    if "ngen_ngiab" not in next(iter(by_name.values()), {}):
        pytest.skip("ngen_metrics does not contain ngen_ngiab row")

    # Our side: pull the joined timeseries and recompute.
    series = reader.get_joined_timeseries(
        "ngen_ngiab", "streamflow_hourly_inst", loc
    )
    primary = [pt["y"] for pt in series[0]["data"]]
    secondary = [pt["y"] for pt in series[1]["data"]]
    assert primary and secondary and len(primary) == len(secondary)

    our = {
        "relative_bias": _relative_bias(primary, secondary),
        "nash_sutcliffe_efficiency": _nash_sutcliffe(primary, secondary),
        "kling_gupta_efficiency": _kling_gupta(primary, secondary),
        "root_mean_standard_deviation_ratio": _root_mean_standard_deviation_ratio(
            primary, secondary
        ),
    }

    mismatches = []
    for metric, our_val in our.items():
        teehr_val = by_name[metric]["ngen_ngiab"]
        if not math.isclose(our_val, teehr_val, rel_tol=METRIC_RTOL, abs_tol=METRIC_ATOL):
            mismatches.append(
                f"{metric}: ours={our_val!r}  teehr={teehr_val!r}  "
                f"delta={our_val - teehr_val:.3e}"
            )
    assert not mismatches, (
        "Our join diverged from teehr's ngen_metrics. This usually means the "
        "join semantics in get_joined_timeseries no longer match teehr's "
        "joined_timeseries_view(). Details:\n  " + "\n  ".join(mismatches)
    )
