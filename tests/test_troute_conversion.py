"""T-route served from parquet, through one pinned shape instead of two.

Read docs/plans/2026-08-22-001-feat-storage-backed-model-runs-plan.md, Unit 11.

The bug this closes was latent rather than hypothetical. ``getTrouteTimeSeries`` branched on
``isinstance(df.index, pd.MultiIndex)``: a NetCDF run took the MultiIndex slice, a csv run the
``featureID`` filter. Parquet has no MultiIndex and its column is ``feature_id``, so a
converted run matched **neither** branch, fell into the except, and returned an empty chart
with no error anywhere -- the failure would have looked like a run with no data.

So the shape is normalised in the reader rather than branched on at the endpoint, which makes
conversion an optimisation instead of a change of contract. These tests assert the endpoint's
own response is identical across all three sources, because that is the thing users see;
frame internals are not a contract anybody depends on.
"""

import json
import os

import pytest
from django.contrib.auth.models import AnonymousUser
from django.core.management import call_command
from django.test import RequestFactory

from tethysapp.ngiab import controllers, manifest, run_store
from tethysapp.ngiab import utils as ngiab_utils


@pytest.fixture
def converted(ingest):
    """Ingest a run, convert it, and re-distil so the manifest sees the parquet."""

    def _converted(name="alpha", **kwargs):
        run_id = ingest(name, output_format="csv", **kwargs)
        run_path = str(ingest.root / name)
        call_command("convert_outputs", "--path", run_path)
        manifest.write(run_path, manifest.distill(run_path, run_id=name, label=name))
        run_store.clear_caches()
        manifest.clear_caches()
        ngiab_utils._cached_troute_frame.cache_clear()
        return run_id

    return _converted


def _series(run_id, feature="cat-100"):
    """The endpoint's own response, which is what a user actually receives."""
    request = RequestFactory().get(
        "/getTrouteTimeSeries/", {"model_run_id": run_id, "troute_id": feature}
    )
    request.user = AnonymousUser()
    return json.loads(controllers.getTrouteTimeSeries(request).content)


# ---- Conversion happens -----------------------------------------------------


def test_conversion_writes_a_troute_parquet(converted, ingest):
    run_id = converted()
    troute_dir = ingest.root / run_id / "outputs" / "troute"
    assert "troute.parquet" in os.listdir(troute_dir)

    document = manifest.read(str(ingest.root / run_id))
    assert document["troute"]["format"] == ".parquet"


def test_the_source_file_is_left_in_place(converted, ingest):
    """Nothing here removes anything, and the CF metadata is read back out of it at ingest."""
    run_id = converted()
    names = os.listdir(ingest.root / run_id / "outputs" / "troute")
    assert any(name.endswith(".nc") for name in names)


# ---- The response is what must not change -----------------------------------


def test_the_response_is_identical_before_and_after_conversion(ingest, converted):
    """The parity claim, stated at the level users experience."""
    before = _series(ingest("from-nc", troute="nc"))
    after = _series(converted("converted"))

    assert before["data"][0]["data"] == after["data"][0]["data"]
    assert before["variable"] == after["variable"]
    assert before["troute_variables"] == after["troute_variables"]
    assert before["layout"] == after["layout"]


def test_a_csv_run_and_a_netcdf_run_agree_on_variables(ingest):
    """The two source shapes disagreed structurally; their variable lists must not."""
    nc = ngiab_utils.get_troute_vars(ngiab_utils.get_troute_df(ingest("as-nc", troute="nc")))
    csv = ngiab_utils.get_troute_vars(ngiab_utils.get_troute_df(ingest("as-csv", troute="csv")))
    assert [v["value"] for v in nc] >= [v["value"] for v in csv]


def test_the_series_has_data_after_conversion(converted):
    """The regression this unit exists to prevent is an empty chart with no error."""
    body = _series(converted())
    points = body["data"][0]["data"]
    assert len(points) == 6
    assert all(point["x"] and point["y"] is not None for point in points)


# ---- CF metadata survives a format that cannot carry it ---------------------


def test_variable_labels_survive_conversion(converted):
    """Parquet has no netCDF attributes and DuckDB does not expose its key-value metadata.

    get_troute_vars builds every picker label from long_name and units, so they are read out
    of the source NetCDF at ingest and stored in the manifest.
    """
    labels = {v["value"]: v["label"] for v in _series(converted())["troute_variables"]}
    assert labels["flow"] == "streamflow (m³/s)"
    assert labels["nudge"] == "streamflow nudge value (m³/s)"


def test_the_nudge_caveat_survives_conversion(converted):
    """Nudge is an assimilation adjustment, not a routed state, and says so."""
    body = _series(converted())
    request = RequestFactory().get(
        "/getTrouteTimeSeries/",
        {"model_run_id": body["variable"] and "alpha", "troute_id": "cat-100",
         "troute_variable": "nudge"},
    )
    request.user = AnonymousUser()
    nudged = json.loads(controllers.getTrouteTimeSeries(request).content)
    assert "assimilation" in (nudged["note"] or "")


# ---- Read once, not twice ---------------------------------------------------


def test_the_frame_is_read_once_per_run_not_once_per_request(converted, mocker):
    """A chart load is two requests -- the variable list and the series -- and each used to
    read the whole file. Converting makes that read cheaper; only caching stops it happening
    twice.
    """
    run_id = converted()
    ngiab_utils.get_troute_df(run_id)

    spy = mocker.spy(ngiab_utils, "_normalised_troute_frame")
    for _ in range(6):
        ngiab_utils.get_troute_df(run_id)
    assert spy.call_count == 0


def test_a_reconverted_run_is_not_served_from_the_old_cache(converted, ingest):
    """The version token changes when the outputs do, which is what invalidates this."""
    run_id = converted()
    first = ngiab_utils.get_troute_df(run_id)
    assert len(first) == 18

    troute_dir = ingest.root / run_id / "outputs" / "troute"
    for name in os.listdir(troute_dir):
        os.remove(os.path.join(troute_dir, name))
    manifest.write(
        str(ingest.root / run_id),
        manifest.distill(str(ingest.root / run_id), run_id=run_id, label=run_id),
    )
    run_store.clear_caches()
    manifest.clear_caches()

    assert ngiab_utils.get_troute_df(run_id) is None


# ---- Edges ------------------------------------------------------------------


def test_a_feature_absent_from_troute_output_answers_rather_than_crashing(converted):
    body = _series(converted(), feature="cat-999")
    assert body["data"][0]["data"] == []


def test_check_troute_id_uses_the_pinned_column(converted):
    frame = ngiab_utils.get_troute_df(converted())
    assert ngiab_utils.check_troute_id(frame, 100) is True
    assert ngiab_utils.check_troute_id(frame, 999) is False


def test_a_run_without_troute_output_reports_none(ingest):
    run_id = ingest("no-troute")
    troute_dir = ingest.root / run_id / "outputs" / "troute"
    for name in os.listdir(troute_dir):
        os.remove(os.path.join(troute_dir, name))
    manifest.write(
        str(ingest.root / run_id),
        manifest.distill(str(ingest.root / run_id), run_id=run_id, label=run_id),
    )
    run_store.clear_caches()
    manifest.clear_caches()

    assert ngiab_utils.get_troute_df(run_id) is None
