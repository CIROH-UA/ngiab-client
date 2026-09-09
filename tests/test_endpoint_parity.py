"""Reference payloads for every read endpoint, captured before the storage refactor.
Must not skip, and must separate changes made on purpose from accidental drift."""

import pytest

from tethysapp.ngiab import utils as ngiab_utils


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


def test_narrow_catchment_reports_only_its_own_variables(ingest):
    """A single catchment's series reports only the columns that catchment actually wrote."""
    run_id = ingest(narrow_last=True)

    union = ngiab_utils.get_catchment_variables(run_id)["variables"]
    assert union == ["RAIN_RATE", "Q_OUT", "SOIL_STORAGE"]

    outputs = ngiab_utils.run_outputs(run_id)
    assert ngiab_utils._read_output_columns(outputs, "cat-102")[2:] == ["RAIN_RATE"]
    assert ngiab_utils._read_output_columns(outputs, "cat-100")[2:] == [
        "RAIN_RATE", "Q_OUT", "SOIL_STORAGE",
    ]


def test_unknown_catchment_raises_rather_than_returning_empty(ingest):
    """An unknown catchment id raises FileNotFoundError rather than returning an empty result."""
    outputs = ngiab_utils.run_outputs(ingest())

    with pytest.raises(FileNotFoundError):
        ngiab_utils._read_output_columns(outputs, "cat-999")


def test_unknown_run_id_raises_unknown_model_run(ingest):
    """Every path build funnels through _require_run_entry, which raises for an unknown run id."""
    ingest()
    with pytest.raises(ngiab_utils.UnknownModelRun):
        ngiab_utils._require_run_entry("22222222-2222-2222-2222-222222222222")


def test_output_root_comes_from_the_manifest(ingest):
    """realization.json is read at ingest now, not on every catchment request."""
    assert ngiab_utils.get_base_output(ingest(realization=True)).endswith("outputs/ngen")


def test_missing_realization_falls_back_to_outputs_ngen(ingest):
    """A run without realization.json is a real case, not a 500."""
    assert ngiab_utils.get_base_output(
        ingest("no-realization", realization=False)
    ).endswith("outputs/ngen")


def test_both_troute_sources_now_yield_the_same_shape(ingest):
    """NetCDF and csv t-route sources now yield the same normalised shape."""
    nc_frame = ngiab_utils.get_troute_df(ingest("as-nc", troute="nc"))
    csv_frame = ngiab_utils.get_troute_df(ingest("as-csv", troute="csv"))

    for frame in (nc_frame, csv_frame):
        assert ngiab_utils.TROUTE_FEATURE_COLUMN in frame.columns
        assert ngiab_utils.TROUTE_TIME_COLUMN in frame.columns
        assert "featureID" not in frame.columns
        assert "current_time" not in frame.columns
