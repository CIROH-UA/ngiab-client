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

Originally these stubbed the registry with hand-written dicts. Unit 9 moved them onto the
``ingest`` fixture, which puts a real run under a real storage root and distils it, because a
stub cannot carry a manifest and the manifest is where every fact the read path needs now
lives. The assertions did not change -- only what stands behind them, and it is more faithful
than what it replaced.
"""

import pytest

from tethysapp.ngiab import utils as ngiab_utils

# ---- The fixture itself is real-shaped -------------------------------------


def test_generated_run_is_readable_by_the_app(ingest):
    """The generator writes what the readers expect, not merely plausible bytes."""
    run_id = ingest()

    assert ngiab_utils.getCatchmentsList(run_id) == ["cat-100", "cat-101", "cat-102"]

    variables = ngiab_utils.get_catchment_variables(run_id)
    assert variables["time_column"] == "Time"
    assert variables["variables"] == ["RAIN_RATE", "Q_OUT", "SOIL_STORAGE"]


def test_gpkg_bounds_reproject_to_4326(ingest):
    """A projected fabric CRS is reprojected at ingest, and the manifest carries the result."""
    bounds = ngiab_utils.run_bounds_4326(ingest())
    assert bounds is not None
    west, south, east, north = bounds
    assert -130 < west < -60 and -130 < east < -60
    assert 20 < south < 55 and 20 < north < 55
    assert west < east and south < north


def test_flowpath_crosswalk_resolves(ingest):
    """describe_troute_feature still answers the pairing, now from the distilled crosswalk."""
    flowpath_id, divide_id = ngiab_utils.describe_troute_feature(ingest(), 100)
    assert (flowpath_id, divide_id) == ("wb-100", "cat-100")


def test_troute_netcdf_carries_cf_metadata(ingest):
    """get_troute_vars builds its labels from long_name and units, so both must survive."""
    frame = ngiab_utils.get_troute_df(ingest())
    assert frame is not None

    labels = {entry["value"]: entry["label"] for entry in ngiab_utils.get_troute_vars(frame)}
    assert labels["flow"] == "streamflow (m³/s)"
    assert labels["nudge"] == "streamflow nudge value (m³/s)"


# ---- Must not change: csv and parquet are the same run ---------------------


def test_csv_and_parquet_agree_on_variables(ingest):
    """The reader prefers parquet; both formats must answer identically."""
    from_csv = ngiab_utils.get_catchment_variables(ingest("as-csv", output_format="csv"))
    from_parquet = ngiab_utils.get_catchment_variables(
        ingest("as-parquet", output_format="parquet")
    )
    assert from_csv == from_parquet


def test_csv_and_parquet_agree_on_a_series(ingest):
    """Column projection over parquet must not change the values the chart plots."""
    from_csv = ngiab_utils._read_output_frame(
        ngiab_utils.run_outputs(ingest("as-csv", output_format="csv")),
        "cat-101", ["Time", "Q_OUT"], time_column="Time",
    )
    from_parquet = ngiab_utils._read_output_frame(
        ngiab_utils.run_outputs(ingest("as-parquet", output_format="parquet")),
        "cat-101", ["Time", "Q_OUT"], time_column="Time",
    )

    assert from_csv["Time"].tolist() == from_parquet["Time"].tolist()
    assert from_csv["Q_OUT"].tolist() == from_parquet["Q_OUT"].tolist()


# ---- Must not change: the heterogeneous-schema contract --------------------


def test_narrow_catchment_reports_only_its_own_variables(ingest):
    """What union_by_name=true protects, and what Unit 10's consolidation threatens.

    The run-wide variable list is the union across catchments, but a single catchment's own
    series must report only the columns that catchment actually wrote. Consolidating every
    catchment into one parquet object makes the union the only answer available unless the
    layout is chosen to prevent it.
    """
    run_id = ingest(narrow_last=True)

    union = ngiab_utils.get_catchment_variables(run_id)["variables"]
    assert union == ["RAIN_RATE", "Q_OUT", "SOIL_STORAGE"]

    outputs = ngiab_utils.run_outputs(run_id)
    assert ngiab_utils._read_output_columns(outputs, "cat-102")[2:] == ["RAIN_RATE"]
    assert ngiab_utils._read_output_columns(outputs, "cat-100")[2:] == [
        "RAIN_RATE", "Q_OUT", "SOIL_STORAGE",
    ]


# ---- Must not change: unknown ids answer, rather than failing --------------


def test_unknown_catchment_raises_rather_than_returning_empty(ingest):
    """_find_output_file's FileNotFoundError is what becomes the endpoint's 404.

    Unit 10 replaces file-per-catchment lookup with a filtered scan, which returns an empty
    result for an id that was never written. Preserving this distinction is the difference
    between "this run has no output for cat-999" and a blank chart.
    """
    outputs = ngiab_utils.run_outputs(ingest())

    with pytest.raises(FileNotFoundError):
        ngiab_utils._read_output_columns(outputs, "cat-999")


def test_unknown_run_id_raises_unknown_model_run(ingest):
    """Every path build funnels through _require_model_run_path; keep the funnel."""
    ingest()
    with pytest.raises(ngiab_utils.UnknownModelRun):
        ngiab_utils._require_model_run_path("22222222-2222-2222-2222-222222222222")


# ---- Must not change: output directory resolution --------------------------


def test_output_root_comes_from_the_manifest(ingest):
    """realization.json is read at ingest now, not on every catchment request."""
    assert ngiab_utils.get_base_output(ingest(realization=True)).endswith("outputs/ngen")


def test_missing_realization_falls_back_to_outputs_ngen(ingest):
    """A run without realization.json is a real case, not a 500."""
    assert ngiab_utils.get_base_output(
        ingest("no-realization", realization=False)
    ).endswith("outputs/ngen")


# ---- Changed deliberately in Unit 11: the two troute shapes became one ------


def test_both_troute_sources_now_yield_the_same_shape(ingest):
    """This test replaces the one that recorded the divergence, and closes it.

    Before Unit 11 the NetCDF path yielded a MultiIndex keyed on feature_id and the csv path
    a flat frame with featureID and current_time, and getTrouteTimeSeries branched on which.
    That branching is what a converted run fell between, matching neither and returning an
    empty chart without raising. Both are normalised now.
    """
    nc_frame = ngiab_utils.get_troute_df(ingest("as-nc", troute="nc"))
    csv_frame = ngiab_utils.get_troute_df(ingest("as-csv", troute="csv"))

    for frame in (nc_frame, csv_frame):
        assert ngiab_utils.TROUTE_FEATURE_COLUMN in frame.columns
        assert ngiab_utils.TROUTE_TIME_COLUMN in frame.columns
        assert "featureID" not in frame.columns
        assert "current_time" not in frame.columns
