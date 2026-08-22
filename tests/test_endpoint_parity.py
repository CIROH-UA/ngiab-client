"""Reference payloads for every read endpoint, captured before the storage refactor.

Read docs/plans/2026-08-22-001-feat-storage-backed-model-runs-plan.md, Unit 1. This suite is
the verification substrate for the eleven units that follow: each of them removes a
filesystem probe, changes an on-disk layout, or rewrites a reader, and each one's stated
verification is "parity holds".

Two properties matter more than coverage:

1. **It cannot skip.** conftest generates its own run, so an absent fixture is an error, not
   a silent pass. The existing test_teehr_warehouse.py suite skips 19 of 28 tests without its
   fixture warehouse, which in CI is indistinguishable from green.
2. **It separates "must not change" from "changes deliberately".** Units 10 and 11 alter what
   the readers see on purpose. A blanket byte-identical assertion across every endpoint would
   be unsatisfiable, and an unsatisfiable assertion gets relaxed during implementation --
   which is when a silent regression ships. Endpoints are marked below.

The registry is stubbed at `_get_list_model_runs`, the seam Unit 5 reimplements, exactly as
tests/test_teehr_warehouse.py already does. Note what that does and does not prove: it pins
the consumer side. Unit 5 must separately assert that the real manifest-backed producer emits
a dict of this shape.
"""

import pytest

from tethysapp.ngiab import utils as ngiab_utils

RUN_ID = "11111111-1111-1111-1111-111111111111"


@pytest.fixture
def registered(monkeypatch):
    """Register a run directory under a known id, without touching the database."""

    def register(path, run_id=RUN_ID):
        entry = {
            "label": "mini",
            "path": path,
            "date": "2026-08-22:00:00:00",
            "id": run_id,
            "subset": "",
            "tags": [],
            "teehr_configuration_name": "",
        }
        monkeypatch.setattr(
            ngiab_utils, "_get_list_model_runs", lambda: {"model_runs": [entry]}
        )
        _clear_caches()
        return run_id

    yield register
    _clear_caches()


def _clear_caches():
    """Drop the per-process LRU caches between runs sharing a directory-shaped key.

    These caches key on (directory, fingerprint), and tmp_path gives every run its own
    directory, so collisions are not the concern -- staleness within one test is. Clearing is
    cheap and makes each test independent of ordering.
    """
    ngiab_utils._cached_catchment_variables.cache_clear()
    ngiab_utils._cached_value_matrix.cache_clear()
    ngiab_utils.describe_troute_feature.cache_clear()


# ---- The fixture itself is real-shaped -------------------------------------


def test_generated_run_is_readable_by_the_app(mini_run, registered):
    """The generator writes what the readers expect, not merely plausible bytes."""
    run_id = registered(mini_run)

    assert ngiab_utils.getCatchmentsList(run_id) == ["cat-100", "cat-101", "cat-102"]

    variables = ngiab_utils.get_catchment_variables(run_id)
    assert variables["time_column"] == "Time"
    assert variables["variables"] == ["RAIN_RATE", "Q_OUT", "SOIL_STORAGE"]


def test_gpkg_bounds_reproject_to_4326(mini_run, registered):
    """A projected fabric CRS reaches gpkg_layer_bounds_4326's transform path."""
    registered(mini_run)
    gpkg = ngiab_utils._find_gpkg_file_path(mini_run)
    assert gpkg is not None

    bounds = ngiab_utils.gpkg_layer_bounds_4326(gpkg)
    assert bounds is not None
    west, south, east, north = bounds
    assert -130 < west < -60 and -130 < east < -60
    assert 20 < south < 55 and 20 < north < 55
    assert west < east and south < north


def test_flowpath_crosswalk_resolves(mini_run, registered):
    """describe_troute_feature reads the pairing out of the GeoPackage's flowpaths table."""
    run_id = registered(mini_run)
    flowpath_id, divide_id = ngiab_utils.describe_troute_feature(run_id, 100)
    assert (flowpath_id, divide_id) == ("wb-100", "cat-100")


def test_troute_netcdf_carries_cf_metadata(mini_run, registered):
    """get_troute_vars builds its labels from long_name and units, so both must survive."""
    run_id = registered(mini_run)
    frame = ngiab_utils.get_troute_df(run_id)
    assert frame is not None

    labels = {entry["value"]: entry["label"] for entry in ngiab_utils.get_troute_vars(frame)}
    assert labels["flow"] == "streamflow (m³/s)"
    assert labels["nudge"] == "streamflow nudge value (m³/s)"


# ---- Must not change: csv and parquet are the same run ---------------------


def test_csv_and_parquet_agree_on_variables(mini_run_factory, registered):
    """The reader prefers parquet; both formats must answer identically."""
    csv_run = mini_run_factory(output_format="csv")
    registered(csv_run)
    from_csv = ngiab_utils.get_catchment_variables(RUN_ID)

    parquet_run = mini_run_factory(output_format="parquet")
    registered(parquet_run)
    from_parquet = ngiab_utils.get_catchment_variables(RUN_ID)

    assert from_csv == from_parquet


def test_csv_and_parquet_agree_on_a_series(mini_run_factory, registered):
    """Column projection over parquet must not change the values the chart plots."""
    csv_run = mini_run_factory(output_format="csv")
    registered(csv_run)
    from_csv = ngiab_utils._read_output_frame(
        ngiab_utils.get_base_output(RUN_ID), "cat-101", ["Time", "Q_OUT"], time_column="Time"
    )

    parquet_run = mini_run_factory(output_format="parquet")
    registered(parquet_run)
    from_parquet = ngiab_utils._read_output_frame(
        ngiab_utils.get_base_output(RUN_ID), "cat-101", ["Time", "Q_OUT"], time_column="Time"
    )

    assert from_csv["Time"].tolist() == from_parquet["Time"].tolist()
    assert from_csv["Q_OUT"].tolist() == from_parquet["Q_OUT"].tolist()


# ---- Must not change: the heterogeneous-schema contract --------------------


def test_narrow_catchment_reports_only_its_own_variables(mini_run_factory, registered):
    """What union_by_name=true protects, and what Unit 10's consolidation threatens.

    The run-wide variable list is the union across catchments, but a single catchment's own
    series must report only the columns that catchment actually wrote. Consolidating every
    catchment into one parquet object makes the union the only answer available unless the
    layout is chosen to prevent it.
    """
    run = mini_run_factory(narrow_last=True)
    run_id = registered(run)

    union = ngiab_utils.get_catchment_variables(run_id)["variables"]
    assert union == ["RAIN_RATE", "Q_OUT", "SOIL_STORAGE"]

    directory = ngiab_utils.get_base_output(run_id)
    narrow = ngiab_utils._read_output_columns(directory, "cat-102")
    assert narrow[2:] == ["RAIN_RATE"]

    wide = ngiab_utils._read_output_columns(directory, "cat-100")
    assert wide[2:] == ["RAIN_RATE", "Q_OUT", "SOIL_STORAGE"]


# ---- Must not change: unknown ids answer, rather than failing --------------


def test_unknown_catchment_raises_rather_than_returning_empty(mini_run, registered):
    """_find_output_file's FileNotFoundError is what becomes the endpoint's 404.

    Unit 10 replaces file-per-catchment lookup with a filtered scan, which returns an empty
    result for an id that was never written. Preserving this distinction is the difference
    between "this run has no output for cat-999" and a blank chart.
    """
    run_id = registered(mini_run)
    directory = ngiab_utils.get_base_output(run_id)

    with pytest.raises(FileNotFoundError):
        ngiab_utils._find_output_file(directory, "cat-999")


def test_unknown_run_id_raises_unknown_model_run(mini_run, registered):
    """Every path build funnels through _require_model_run_path; keep the funnel."""
    registered(mini_run)
    with pytest.raises(ngiab_utils.UnknownModelRun):
        ngiab_utils._require_model_run_path("22222222-2222-2222-2222-222222222222")


# ---- Must not change: output directory resolution --------------------------


def test_output_root_is_read_from_realization(mini_run_factory, registered):
    """resolve_output_dir reads config/realization.json on every catchment request."""
    run = mini_run_factory(realization=True)
    registered(run)
    assert ngiab_utils.get_base_output(RUN_ID).endswith("outputs/ngen")


def test_missing_realization_falls_back_to_outputs_ngen(mini_run_factory, registered):
    """A run without realization.json is a real case, not a 500."""
    run = mini_run_factory(realization=False)
    registered(run)
    assert ngiab_utils.get_base_output(RUN_ID).endswith("outputs/ngen")


# ---- Changes deliberately in Unit 11: both troute shapes, captured separately ----


def test_troute_netcdf_and_csv_shapes_differ_today(mini_run_factory, registered):
    """Record the divergence Unit 11 has to reconcile, rather than assume it away.

    The NetCDF path yields a MultiIndex frame keyed on feature_id; the csv path yields a flat
    frame with a featureID column. getTrouteTimeSeries branches on exactly that difference. A
    single pinned parquet schema cannot reproduce both, so Unit 11 must state which one it
    targets and what the other's diff becomes -- this test is where that decision gets
    recorded.
    """
    import pandas as pd

    nc_run = mini_run_factory(troute="nc")
    registered(nc_run)
    nc_frame = ngiab_utils.get_troute_df(RUN_ID)

    csv_run = mini_run_factory(troute="csv")
    registered(csv_run)
    csv_frame = ngiab_utils.get_troute_df(RUN_ID)

    assert isinstance(nc_frame.index, pd.MultiIndex)
    assert "feature_id" in nc_frame.index.names

    assert not isinstance(csv_frame.index, pd.MultiIndex)
    assert "featureID" in csv_frame.columns
