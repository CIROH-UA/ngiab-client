"""A failure tells the caller what went wrong, never where the server keeps it.

Both handlers already pass the exception to logger.exception, so interpolating it into the
response body added nothing an operator did not already have and put an absolute server path
on a user's screen. The frontend only drops replies over 200 characters, multiline ones, and
ones carrying a traceback or a memory address -- a short single-line OSError passes its filter
untouched and is rendered verbatim.
"""

import json

import duckdb
import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.test import RequestFactory

from tethysapp.ngiab import controllers, run_store

LEAKS = ("/var/lib", "/opt/", "Errno", "Traceback", ".parquet", "tethys_persist")


def _assert_discloses_nothing(response, *extra):
    body = json.loads(response.content)["error"]
    for leak in (*LEAKS, *extra):
        assert leak not in body, f"{leak!r} reached the client in {body!r}"
    return body


@pytest.fixture
def permitted(db, monkeypatch):
    """A caller the permission system says yes to, without an installed app row."""
    monkeypatch.setattr(controllers, "has_permission", lambda request, perm: True)
    return get_user_model()(username="operator", is_active=True)


def test_a_failed_delete_does_not_name_the_directory(ingest, permitted, monkeypatch):
    run_id = ingest()

    def explode(_name):
        raise OSError(2, None, f"/var/lib/tethys_persist/ngiab_visualizer/{run_id}/outputs")

    monkeypatch.setattr(run_store, "delete", explode)
    request = RequestFactory().post("/removeModelRun/", {"model_run_id": run_id})
    request.user = permitted

    response = controllers.removeModelRun(request)

    assert response.status_code == 500
    _assert_discloses_nothing(response)


def test_an_unreadable_matrix_does_not_name_the_file_or_the_query(ingest, monkeypatch):
    run_id = ingest()

    def explode(*_args, **_kwargs):
        raise duckdb.Error(
            'Binder Error: Referenced column "catchment_id" not found in '
            f'"/var/lib/tethys_persist/ngiab_visualizer/{run_id}/outputs/troute.parquet"'
        )

    monkeypatch.setattr(controllers, "get_catchment_value_matrix", explode)
    request = RequestFactory().get(
        "/getCatchmentValueMatrix/", {"model_run_id": run_id, "variable": "Q_OUT"}
    )
    request.user = AnonymousUser()

    response = controllers.getCatchmentValueMatrix(request)

    _assert_discloses_nothing(response, "Binder Error", "catchment_id")


def test_the_caller_is_still_told_that_something_failed(ingest, permitted, monkeypatch):
    """Withholding the path must not degrade into a silent success."""
    run_id = ingest()
    monkeypatch.setattr(
        run_store, "delete", lambda _name: (_ for _ in ()).throw(OSError("denied"))
    )
    request = RequestFactory().post("/removeModelRun/", {"model_run_id": run_id})
    request.user = permitted

    response = controllers.removeModelRun(request)

    assert response.status_code == 500
    assert "delete" in json.loads(response.content)["error"].lower()
