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

LEAKS = ("/var/lib", "/opt/", "/home/tethys", "Errno", "Traceback", ".parquet", "persist")


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
        raise OSError(2, None, f"/home/tethys/persist/ngiab_visualizer/{run_id}/outputs")

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
            f'"/home/tethys/persist/ngiab_visualizer/{run_id}/outputs/troute.parquet"'
        )

    monkeypatch.setattr(controllers, "get_catchment_value_matrix", explode)
    request = RequestFactory().get(
        "/getCatchmentValueMatrix/", {"model_run_id": run_id, "variable": "Q_OUT"}
    )
    request.user = AnonymousUser()

    response = controllers.getCatchmentValueMatrix(request)

    body = _assert_discloses_nothing(response, "Binder Error", "catchment_id")
    assert body == "Could not read this run's outputs.", (
        "the json_errors wrapper short-circuited; this test never reached the except branch"
    )


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


def test_a_failed_publish_does_not_name_the_path_through_job_status(ingest, monkeypatch, tmp_path):
    """The upload path reports through job status, which the browser renders unfiltered.

    uploadStatus returns the stored document verbatim and the frontend prints message straight
    into the DOM, bypassing the client-side filter the two handlers above rely on -- so this
    surface needs the invariant enforced at the source rather than downstream.
    """
    from django.core.management import call_command

    from tethysapp.ngiab import ingest as ingest_module

    run_id = ingest()
    job_id = "job-leak"

    def explode(*_args, **_kwargs):
        raise OSError(2, None, f"/home/tethys/persist/ngiab_visualizer/{run_id}/outputs")

    monkeypatch.setattr(ingest_module, "publish", explode)
    archive_path = tmp_path / "run.tar.gz"
    archive_path.write_bytes(b"not really an archive")

    with pytest.raises(Exception):
        call_command("ingest_archive", "--job", job_id, "--name", "beta",
                     "--archive", str(archive_path))

    document = ingest_module.read_status(job_id) or {}
    message = document.get("message") or ""
    for leak in LEAKS:
        assert leak not in message, f"{leak!r} reached the job status in {message!r}"
