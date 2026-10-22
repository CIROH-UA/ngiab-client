"""TEEHR axis units, read from the evaluation rather than guessed.

TEEHR's joined_timeseries carries a ``unit_name`` column, and its join requires the
primary and secondary series to agree on it, so the unit for a variable is a fact the
data already states. These pin that it reaches the chart."""

import json

import pytest
from django.contrib.auth.models import AnonymousUser
from django.test import RequestFactory

from tethysapp.ngiab import controllers, teehr_evaluation
from tethysapp.ngiab import utils as ngiab_utils


def _teehr(run_id, **params):
    """The endpoint's own response, which is what a user actually receives."""
    request = RequestFactory().get(
        "/getTeehrTimeSeries/",
        {"model_run_id": run_id, "teehr_id": "usgs-10154200", **params},
    )
    request.user = AnonymousUser()
    return json.loads(controllers.getTeehrTimeSeries(request).content)


def test_the_axis_label_carries_the_unit_teehr_recorded(ingest):
    """The regression this exists to prevent: a discharge axis labelled with no unit."""
    body = _teehr(ingest("with-teehr", teehr=True))
    assert body["layout"]["yaxis"] == "ngen streamflow hourly inst (m³/s)"


def test_the_variable_list_carries_it_too(ingest):
    """The dropdown and the axis are the same string, as they are for t-route."""
    body = _teehr(ingest("with-teehr", teehr=True))
    labels = {entry["value"]: entry["label"] for entry in body["teehr_variables"]}
    assert labels["ngen-streamflow_hourly_inst"] == "ngen streamflow hourly inst (m³/s)"
    assert (
        labels["nwm30_retrospective-streamflow_hourly_inst"]
        == "nwm30 retrospective streamflow hourly inst (m³/s)"
    )


def test_one_option_per_variable_not_one_per_unit(ingest):
    """Grouping, not DISTINCT: adding unit_name must not multiply the dropdown."""
    body = _teehr(ingest("with-teehr", teehr=True))
    values = [entry["value"] for entry in body["teehr_variables"]]
    assert len(values) == len(set(values)) == 2


def test_an_unrecognised_unit_is_shown_as_written(ingest):
    """We show what the evaluation says rather than dropping units we have no mapping for."""
    body = _teehr(ingest("odd-unit", teehr=True, teehr_unit_name="cms"))
    assert body["layout"]["yaxis"] == "ngen streamflow hourly inst (cms)"


def test_a_run_without_an_evaluation_still_answers(ingest):
    """No TEEHR is an ordinary state for a run, not an error."""
    body = _teehr(ingest("no-teehr"))
    assert body["data"] == []
    assert body["teehr_status_severity"] == "info"


@pytest.mark.parametrize(
    "units, expected",
    [
        ("m3 s-1", "m³/s"),   # t-route, CF spelling
        ("m^3/s", "m³/s"),    # TEEHR, same quantity
        ("cms", "cms"),       # unknown to us, passed through
        ("", None),
        (None, None),
    ],
)
def test_unit_label_is_shared_by_both_readers(units, expected):
    """One spelling table, used by t-route and TEEHR alike."""
    assert ngiab_utils.unit_label(units) == expected


def test_the_label_helper_omits_empty_units():
    """A variable with no recorded unit reads as it did before, with no stray parentheses."""
    assert (
        teehr_evaluation._variable_label("ngen", "streamflow_hourly_inst", None)
        == "ngen streamflow hourly inst"
    )
