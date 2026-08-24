"""Uploading an archive publishes a run, and only for people allowed to add one.

The pipeline is one path for both backends -- extract, convert, distil, publish -- because
convert_outputs needs a filesystem either way. What differs is only how the archive arrives.

Two things here are load-bearing beyond "does it work":

1. **The published run's id is the name it was published under.** Everywhere else the id is
   positional, taken from the basename of whatever path distill was handed, and on object
   storage the prefix and the id can drift apart until the picker offers an id that resolves
   to nothing. Ingest controls both, so it is the one place they are made equal.

2. **The job id reaches a storage key and a subprocess argument**, so it is validated as a
   hex uuid rather than trusted.
"""

import json
import os
import tarfile

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.test import RequestFactory

from tethysapp.ngiab import archive, controllers, ingest, manifest, run_store


@pytest.fixture
def permitted(monkeypatch):
    monkeypatch.setattr(controllers, "has_permission", lambda request, perm: True)


@pytest.fixture
def refused(monkeypatch):
    monkeypatch.setattr(controllers, "has_permission", lambda request, perm: False)


@pytest.fixture
def user(db):
    return get_user_model()(username="curator", is_active=True)


@pytest.fixture
def archived(mini_run_factory, tmp_path):
    """A real mini run, tarred the way a user would tar it."""
    def _archived(name="uploaded", **kwargs):
        run = mini_run_factory(name, **kwargs)
        path = tmp_path / f"{name}.tar.gz"
        with tarfile.open(path, "w:gz") as handle:
            handle.add(run, arcname=name)
        return str(path)
    return _archived


@pytest.fixture
def storage_root(tmp_path, monkeypatch):
    from tethysapp.ngiab import duckdb_conn

    root = tmp_path / "runs"
    root.mkdir()
    monkeypatch.delenv(duckdb_conn.STORAGE_BACKEND_ENV, raising=False)
    monkeypatch.setenv(run_store.MANAGED_ROOT_ENV, str(root))
    run_store.clear_caches()
    yield root
    run_store.clear_caches()


# ---- The pipeline -----------------------------------------------------------


def test_an_archive_becomes_a_listed_run(archived, storage_root):
    ingest.publish(archived(), "gage-99")
    assert [entry["name"] for entry in run_store.list_runs()] == ["gage-99"]
    assert (storage_root / "gage-99" / "manifest.json").is_file()


def test_the_published_run_is_readable(archived, storage_root):
    from tethysapp.ngiab import utils as ngiab_utils

    ingest.publish(archived(), "gage-99")
    assert ngiab_utils.getCatchmentsList("gage-99") == ["cat-100", "cat-101", "cat-102"]
    assert ngiab_utils.get_catchment_variables("gage-99")["variables"]


def test_the_id_is_the_name_it_was_published_under(archived, storage_root):
    """Not the archive's top-level directory, which is what distill would take by default."""
    ingest.publish(archived("whatever-the-tar-called-it"), "gage-99")
    document = manifest.read(str(storage_root / "gage-99"))
    assert document["id"] == "gage-99"
    assert document["label"] == "gage-99"


def test_outputs_are_converted_on_the_way_in(archived, storage_root):
    """Otherwise a hosted run uploads thousands of objects and its t-route cannot be read."""
    ingest.publish(archived(), "gage-99")
    document = manifest.read(str(storage_root / "gage-99"))
    assert document["output_format"] == ".parquet"
    assert document["troute"]["format"] == ".parquet"


def test_the_workspace_is_cleaned_up(archived, storage_root, tmp_path):
    import tempfile

    before = set(os.listdir(tempfile.gettempdir()))
    ingest.publish(archived(), "gage-99")
    leaked = {n for n in os.listdir(tempfile.gettempdir()) if n.startswith("ngiab-ingest-")}
    assert leaked - before == set()


# ---- Refusals ----------------------------------------------------------------


def test_a_name_that_is_not_plain_is_refused(archived, storage_root):
    with pytest.raises(archive.ArchiveRejected, match="not a usable run name"):
        ingest.publish(archived(), "../escape")


def test_an_existing_name_is_refused(archived, storage_root):
    ingest.publish(archived("first"), "gage-99")
    with pytest.raises(archive.ArchiveRejected, match="already exists"):
        ingest.publish(archived("second"), "gage-99")


def test_nothing_is_published_when_the_archive_is_rejected(storage_root, tmp_path):
    """A refused archive must not leave a partial directory the picker would list."""
    bad = tmp_path / "notes.txt"
    bad.write_text("not an archive")
    with pytest.raises(archive.ArchiveRejected):
        ingest.publish(str(bad), "gage-99")
    assert run_store.list_runs() == []


# ---- Staging is not a run ----------------------------------------------------


def test_the_staging_directory_is_not_listed_as_a_run(storage_root):
    """It lives under the same root, so without the reserved-name rule it would be."""
    (storage_root / run_store.STAGING_DIR).mkdir()
    (storage_root / "real-run").mkdir()
    run_store.clear_caches()
    assert [e["name"] for e in run_store.list_runs()] == ["real-run"]


def test_status_survives_a_round_trip(storage_root):
    ingest.write_status("a" * 32, state=ingest.RUNNING, stage="converting", message="hi")
    status = ingest.read_status("a" * 32)
    assert status["state"] == ingest.RUNNING
    assert status["stage"] == "converting"


def test_an_unknown_job_has_no_status(storage_root):
    assert ingest.read_status("b" * 32) is None


# ---- The endpoints -----------------------------------------------------------


def _post(view, user, **data):
    request = RequestFactory().post("/x/", data)
    request.user = user
    return view(request)


def test_anonymous_cannot_start_an_upload(refused, storage_root):
    assert _post(controllers.createUpload, AnonymousUser(), name="x").status_code == 401


def test_a_user_without_the_permission_cannot_upload(refused, user, storage_root):
    response = _post(controllers.createUpload, user, name="gage-99")
    assert response.status_code == 403
    assert b"permission" in response.content


def test_a_permitted_user_gets_a_job(permitted, user, storage_root):
    response = _post(controllers.createUpload, user, name="gage-99")
    assert response.status_code == 200
    body = json.loads(response.content)
    assert body["mode"] == "direct"          # no bucket configured in this test
    assert len(body["job"]) == 32


def test_a_taken_name_is_refused_before_the_transfer(permitted, user, archived, storage_root):
    """Being told the name is taken is worth little after waiting out a 6 GB upload."""
    ingest.publish(archived(), "gage-99")
    response = _post(controllers.createUpload, user, name="gage-99")
    assert response.status_code == 409


@pytest.mark.parametrize("name", [
    "../escape", "a/b", "", "with space", ".hidden", "_reserved", "a" * 200, "na\u00efve",
])
def test_an_unusable_name_is_refused(permitted, user, storage_root, name):
    """Uploading chooses the name, so it can insist on one that reads well in an object key."""
    assert _post(controllers.createUpload, user, name=name).status_code == 400


@pytest.mark.parametrize("name", ["gage-07144100", "preproc_test", "run.2026", "a"])
def test_ordinary_names_are_accepted(permitted, user, storage_root, name):
    assert _post(controllers.createUpload, user, name=name).status_code == 200


def test_a_reserved_name_cannot_be_claimed(permitted, user, storage_root):
    """_uploads is where staging lives; a run there would collide with the machinery."""
    assert not ingest.is_valid_name(run_store.STAGING_DIR)


@pytest.mark.parametrize("job", ["", "short", "../../etc/passwd", "z" * 32, "a" * 31])
def test_a_job_id_that_we_did_not_mint_is_refused(permitted, user, storage_root, job):
    """The id reaches a storage key and a subprocess argument."""
    assert _post(controllers.startUpload, user, job=job, name="gage-99").status_code == 400


def test_status_reports_terminal_state(permitted, user, storage_root):
    ingest.write_status("c" * 32, state=ingest.DONE, stage="done", message="ready")
    request = RequestFactory().get("/x/", {"job": "c" * 32})
    request.user = user
    body = json.loads(controllers.uploadStatus(request).content)
    assert body["state"] == ingest.DONE
    assert body["terminal"] is True


def test_status_for_an_unknown_job_is_a_404(permitted, user, storage_root):
    request = RequestFactory().get("/x/", {"job": "d" * 32})
    request.user = user
    assert controllers.uploadStatus(request).status_code == 404


def test_the_page_reports_the_upload_permission(db, permitted, monkeypatch):
    captured = {}

    def fake_render(request, template, context):
        captured.update(context)
        from django.http import HttpResponse
        return HttpResponse("ok")

    monkeypatch.setattr(controllers.App, "render", staticmethod(fake_render))
    request = RequestFactory().get("/")
    request.user = get_user_model()(username="curator", is_active=True)
    controllers.home(request)
    assert captured["can_upload"] is True


def test_the_app_declares_the_upload_permission():
    from tethysapp.ngiab.app import App

    names = [p.name for g in App().permissions() for p in g.permissions]
    assert controllers.UPLOAD_PERMISSION in names
    assert controllers.DELETE_PERMISSION in names


# ---- uploadRun: the endpoint no test reached --------------------------------
#
# Every test above posts to createUpload, startUpload or uploadStatus. Nothing posted here,
# which is how a TypeError in this handler stayed green through 411 tests and three reviews.


@pytest.fixture
def archive_post():
    """A multipart POST of a small archive, as the browser sends on a bucketless deployment."""
    from django.core.files.uploadedfile import SimpleUploadedFile

    def _post(job, name="gage-99"):
        request = RequestFactory().post("/uploadRun/", {
            "job": job,
            "name": name,
            "archive": SimpleUploadedFile("run.tar.gz", b"x" * 64,
                                          content_type="application/gzip"),
        })
        request.user = get_user_model()(username="curator", is_active=True)
        return request

    return _post


def test_uploadRun_launches_the_child_with_the_archive(permitted, storage_root, archive_post,
                                                       monkeypatch):
    """The success path. On its own this would have caught the bug: the handler raised before
    reaching _launch at all."""
    launched = []
    monkeypatch.setattr(controllers, "_launch", lambda args: launched.append(args))

    response = _run_view(controllers.uploadRun, archive_post("a" * 32))

    assert response.status_code == 200
    assert launched, "the ingest child was never launched"
    assert "--archive" in launched[0]
    assert "--job" in launched[0]


def test_uploadRun_leaves_no_archive_when_the_launch_fails(permitted, storage_root,
                                                           archive_post, monkeypatch):
    """The reason the parameter exists. When the child never starts, nothing else removes the
    temp file the handler wrote -- the child's own cleanup never runs."""
    import glob

    monkeypatch.setattr(controllers, "_launch",
                        lambda args: (_ for _ in ()).throw(controllers.IngestBusy("busy")))
    before = set(glob.glob("/tmp/ngiab-*.archive"))

    response = _run_view(controllers.uploadRun, archive_post("b" * 32))

    assert response.status_code == 503
    assert set(glob.glob("/tmp/ngiab-*.archive")) - before == set()


def test_uploadRun_reports_a_failed_job_when_the_launch_fails(permitted, storage_root,
                                                              archive_post, monkeypatch):
    """A status left at PENDING is polled until the staleness window elapses."""
    monkeypatch.setattr(controllers, "_launch",
                        lambda args: (_ for _ in ()).throw(RuntimeError("no django-admin")))

    response = _run_view(controllers.uploadRun, archive_post("c" * 32))

    assert response.status_code == 500
    assert ingest.read_status("c" * 32)["state"] == ingest.FAILED


def _run_view(view, request):
    """Call a view, turning an exception into the 500 Django would produce.

    Without this the TypeError propagates out of the test as an error rather than a failure,
    which reads as a broken test instead of a broken endpoint.
    """
    from django.http import JsonResponse

    try:
        return view(request)
    except Exception as exc:  # noqa: BLE001 - the bug under test is an unhandled raise
        return JsonResponse({"error": f"{type(exc).__name__}: {exc}"}, status=500)
