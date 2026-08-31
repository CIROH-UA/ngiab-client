"""What happens to an upload when something other than the archive goes wrong.
Every state a job can be left in must be legible from its status object alone."""

import os
import time

import pytest
from django.contrib.auth import get_user_model
from django.test import RequestFactory

from tethysapp.ngiab import controllers, ingest, run_store


@pytest.fixture
def permitted(monkeypatch):
    monkeypatch.setattr(controllers, "has_permission", lambda request, perm: True)


@pytest.fixture
def user(db):
    return get_user_model()(username="curator", is_active=True)


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


@pytest.fixture(autouse=True)
def no_running_jobs():
    controllers._running.clear()
    yield
    controllers._running.clear()


def _post(view, user, **data):
    request = RequestFactory().post("/x/", data)
    request.user = user
    return view(request)


def test_a_failed_launch_reports_a_failed_job(permitted, user, storage_root, monkeypatch):
    """A launch failure must report a failed job rather than raising out of the view."""
    def explode(arguments):
        raise FileNotFoundError("django-admin")

    monkeypatch.setattr(controllers, "_launch", explode)
    job = "a" * 32
    response = _post(controllers.startUpload, user, job=job, name="gage-99")

    assert response.status_code == 500
    assert ingest.read_status(job)["state"] == ingest.FAILED


def test_a_failed_launch_discards_the_staged_archive(permitted, user, storage_root,
                                                     monkeypatch):
    discarded = []
    monkeypatch.setattr(controllers, "_launch",
                        lambda a: (_ for _ in ()).throw(RuntimeError("no")))
    monkeypatch.setattr(ingest, "discard_staged", lambda job: discarded.append(job))

    job = "b" * 32
    _post(controllers.startUpload, user, job=job, name="gage-99")
    assert discarded == [job]


def test_ingests_are_bounded(permitted, user, storage_root, monkeypatch):
    """Each conversion holds the GIL through DuckDB, and the portal has one worker."""
    monkeypatch.setattr(controllers, "MAX_CONCURRENT_INGESTS", 2)

    class Live:
        returncode = None

        def poll(self):
            return None

    controllers._running.extend([Live(), Live()])
    response = _post(controllers.startUpload, user, job="c" * 32, name="gage-99")

    assert response.status_code == 503
    assert b"already being prepared" in response.content
    assert ingest.read_status("c" * 32)["state"] == ingest.FAILED


def test_finished_children_are_reaped_and_free_a_slot(storage_root, monkeypatch):
    """Popen handles never waited on leave zombies until the worker exits."""
    monkeypatch.setattr(controllers, "MAX_CONCURRENT_INGESTS", 2)

    class Done:
        returncode = 0

        def poll(self):
            return 0

    controllers._running.extend([Done(), Done()])
    assert controllers._reap() == 0
    assert controllers._running == []


def test_a_job_that_went_quiet_is_reported_failed(storage_root, monkeypatch):
    """A job killed outright is still reported failed rather than left silent forever."""
    job = "d" * 32
    ingest.write_status(job, state=ingest.RUNNING, stage="converting", message="working")
    monkeypatch.setattr(ingest, "STALE_AFTER_SECONDS", 0.0)
    time.sleep(0.01)

    status = ingest.read_status(job)
    assert status["state"] == ingest.FAILED
    assert "stopped responding" in status["message"]


def test_a_recent_job_is_left_alone(storage_root):
    job = "e" * 32
    ingest.write_status(job, state=ingest.RUNNING, stage="converting", message="working")
    assert ingest.read_status(job)["state"] == ingest.RUNNING


def test_a_finished_job_is_never_rewritten_as_stale(storage_root, monkeypatch):
    job = "f" * 32
    ingest.write_status(job, state=ingest.DONE, stage="done", message="ready", run="x")
    monkeypatch.setattr(ingest, "STALE_AFTER_SECONDS", 0.0)
    time.sleep(0.01)
    assert ingest.read_status(job)["state"] == ingest.DONE


def test_a_storage_failure_is_retryable_not_terminal(permitted, user, storage_root,
                                                     monkeypatch):
    """Any error ends the client's poll loop, so a 500 here reported a running job as failed."""
    def unreachable(job):
        raise run_store.StorageUnreachable("bucket said no")

    monkeypatch.setattr(ingest, "read_status", unreachable)
    request = RequestFactory().get("/x/", {"job": "a" * 32})
    request.user = user
    response = controllers.uploadStatus(request)

    assert response.status_code == 503
    import json
    assert json.loads(response.content)["terminal"] is False


class TestAFailedIngestSaysWhy:
    """A detached ingest's traceback has to reach the operator somehow.

    The child writes it to stderr and the job status deliberately carries a fixed sentence, so
    with the child's output on /dev/null a failed upload left nothing behind anywhere: no
    reason in the status by design, and no reason in the log either.
    """

    def _finished(self, returncode, wrote):
        import tempfile

        handle = tempfile.NamedTemporaryFile(prefix="ngiab-test-", delete=False)
        handle.write(wrote.encode())
        handle.close()

        class Finished:
            def __init__(self):
                self.returncode = returncode
                self._ngiab_output_log = handle.name

            def poll(self):
                return self.returncode

        return Finished(), handle.name

    def test_what_the_child_wrote_is_logged_when_it_fails(self, caplog):
        child, path = self._finished(1, "Traceback (most recent call last):\nBoom: no space left")
        controllers._running.append(child)

        with caplog.at_level("ERROR", logger="tethysapp.ngiab.controllers"):
            assert controllers._reap() == 0

        assert "Boom: no space left" in caplog.text
        assert not os.path.exists(path), "the capture file outlived the child"

    def test_a_clean_exit_is_not_reported_as_an_error(self, caplog):
        child, path = self._finished(0, "just a warning about something harmless")
        controllers._running.append(child)

        with caplog.at_level("ERROR", logger="tethysapp.ngiab.controllers"):
            assert controllers._reap() == 0

        assert "harmless" not in caplog.text
        assert not os.path.exists(path)

    def test_a_failure_with_no_output_still_names_the_exit_code(self, caplog):
        child, path = self._finished(137, "")
        controllers._running.append(child)

        with caplog.at_level("ERROR", logger="tethysapp.ngiab.controllers"):
            controllers._reap()

        assert "137" in caplog.text
        assert "wrote nothing" in caplog.text
        assert not os.path.exists(path)

    def test_only_the_tail_of_a_huge_log_is_read(self, caplog):
        noise = "x" * 50_000
        child, path = self._finished(1, noise + "\nthe part that matters")
        controllers._running.append(child)

        with caplog.at_level("ERROR", logger="tethysapp.ngiab.controllers"):
            controllers._reap()

        assert "the part that matters" in caplog.text
        assert len(caplog.text) < 20_000, "a runaway child should not flood the log"
        assert not os.path.exists(path)

    def test_launch_gives_the_child_somewhere_to_write(self, monkeypatch):
        """The capture is the fix; reporting it is only useful if the child is pointed at it."""
        import subprocess

        seen = {}

        class Stub:
            returncode = None

            def poll(self):
                return None

        def record(command, **kwargs):
            seen.update(kwargs)
            return Stub()

        monkeypatch.setattr(subprocess, "Popen", record)
        monkeypatch.setattr(controllers.os.path, "dirname", lambda _p: "/usr/bin")

        controllers._launch(["--job", "d" * 32, "--name", "gage-1"])

        assert seen["stdout"] is not subprocess.DEVNULL
        assert seen["stderr"] is not subprocess.DEVNULL
        assert seen["stdout"] is seen["stderr"], "one stream keeps the interleaving readable"
        assert seen["stdout"].name.endswith(".log")

        child = controllers._running[-1]
        assert getattr(child, "_ngiab_output_log", None), "the child carries no capture path"
        os.unlink(child._ngiab_output_log)
