"""Catchment axis units, and one label shared by the picker and the axis.

ngen's catchment output carries no unit metadata, so unlike t-route these come from a
lookup. The units are CFE's own BMI declarations (`output_var_units` in NOAA-OWP/cfe
src/bmi_cfe.c at a349a953, the commit CIROH-UA/ngen@ngiab pins): every CFE output is a
depth in metres except SURF_RUNOFF_SCHEME, which is a dimensionless flag."""

import json

import pytest
from django.contrib.auth.models import AnonymousUser
from django.test import RequestFactory

from tethysapp.ngiab import controllers
from tethysapp.ngiab import utils as ngiab_utils


def _series(run_id, catchment="cat-100", **params):
    """The endpoint's own response, which is what a user actually receives."""
    request = RequestFactory().get(
        "/getCatchmentTimeSeries/",
        {"model_run_id": run_id, "catchment_id": catchment, **params},
    )
    request.user = AnonymousUser()
    return json.loads(controllers.getCatchmentTimeSeries(request).content)


def test_the_axis_carries_the_unit(ingest):
    """The regression this exists to prevent: a depth axis labelled with no unit."""
    body = _series(ingest(), variable_column="SOIL_STORAGE")
    assert body["layout"]["yaxis"] == "soil storage (m)"


def test_the_picker_and_the_axis_are_the_same_string(ingest):
    """They disagreed before -- the picker was prettified, the axis was the raw name."""
    body = _series(ingest(), variable_column="RAIN_RATE")
    labels = {entry["value"]: entry["label"] for entry in body["variables"]}
    assert labels["RAIN_RATE"] == body["layout"]["yaxis"] == "rain rate (m)"


def test_every_generated_variable_is_labelled(ingest):
    """No CFE output should reach the chart as a bare name."""
    body = _series(ingest())
    for entry in body["variables"]:
        assert entry["label"].endswith("(m)"), entry


def test_a_dimensionless_flag_gets_no_parentheses(ingest):
    """SURF_RUNOFF_SCHEME is a scheme id, not a measurement; CFE declares it 'none'."""
    assert ngiab_utils.get_catchment_vars(["SURF_RUNOFF_SCHEME"]) == [
        {"value": "SURF_RUNOFF_SCHEME", "label": "surf runoff scheme"}
    ]


def test_an_unknown_variable_keeps_its_bare_label(ingest):
    """A non-CFE column still reads as it did before, with no stray parentheses."""
    assert ngiab_utils.get_catchment_vars(["SOMETHING_ELSE"]) == [
        {"value": "SOMETHING_ELSE", "label": "something else"}
    ]


def test_the_lookup_is_case_insensitive():
    """ngen writes CFE short names uppercase; the map is keyed lowercase."""
    upper = ngiab_utils.get_catchment_vars(["GW_STORAGE"])[0]["label"]
    lower = ngiab_utils.get_catchment_vars(["gw_storage"])[0]["label"]
    assert upper == "gw storage (m)"
    assert lower == "gw storage (m)"


@pytest.mark.parametrize(
    "variable",
    ["RAIN_RATE", "GIUH_RUNOFF", "GW_STORAGE", "SOIL_STORAGE"],
)
def test_the_four_storage_and_flux_variables_are_metres(variable):
    """These four were previously shown as mm/h, mm, m/m and m/m in the React client.

    CFE declares all four as `m`, and a run confirms it: GW_STORAGE tracks each
    catchment's own max_gw_storage rather than sitting at the initial fraction, and
    RAIN_RATE closes a water balance against Q_OUT, ACTUAL_ET and the storages.
    """
    assert ngiab_utils.get_catchment_vars([variable])[0]["label"].endswith("(m)")


def test_the_value_is_untouched(ingest):
    """This changes a label, not a number. The series payload must be unaffected."""
    body = _series(ingest(), variable_column="RAIN_RATE")
    series = body["data"][0]
    assert series["points"] == 6
    assert len(series["v"]) == 6
    assert series["label"] == "cat-100-RAIN_RATE"
