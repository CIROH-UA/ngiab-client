"""A job that is working must not be mistaken for a job that has died.

Staleness is the only evidence available that an ingest died -- nothing supervises the child,
and a SIGKILL writes no status. But it was measuring the wrong thing: status was written only
at stage boundaries, and conversion is one blocking call, so a run large enough to convert for
longer than the window was declared dead while it was still working. The client stopped
polling and said it failed; the job then published anyway.

These tests pin the two halves of the fix: a working job keeps its timestamp moving, and a
dead one still stops.
"""

import json
import os
import time

import pytest

from tethysapp.ngiab import ingest, run_store


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


@pytest.fixture
def brisk(monkeypatch):
    """Beat fast enough to observe, stale fast enough to observe."""
    monkeypatch.setattr(ingest, "STALE_AFTER_SECONDS", 0.4)
    monkeypatch.setattr(ingest, "heartbeat_seconds", lambda: 0.05)


# ---- A working job stays alive ------------------------------------------------


def test_a_slow_stage_keeps_the_timestamp_moving(storage_root, brisk):
    """The whole point: without this, work longer than the window reads as death."""
    job = "a" * 32
    ingest.write_status(job, state=ingest.RUNNING, stage="converting", message="working")
    first = ingest.read_status(job)["updated"]

    with ingest._heartbeat(job, lambda: ("converting", "working")):
        time.sleep(0.3)

    later = ingest.read_status(job)
    assert later["state"] == ingest.RUNNING, "a beating job must not read as failed"
    assert later["updated"] > first


def test_a_stage_longer_than_the_stale_window_is_not_declared_dead(storage_root, brisk):
    """Sleeping well past STALE_AFTER_SECONDS, which is what used to kill a big conversion."""
    job = "b" * 32
    ingest.write_status(job, state=ingest.RUNNING, stage="converting", message="working")

    with ingest._heartbeat(job, lambda: ("converting", "working")):
        time.sleep(ingest.STALE_AFTER_SECONDS * 2.5)
        during = ingest.read_status(job)

    assert during["state"] == ingest.RUNNING
    assert "stopped responding" not in (during["message"] or "")


def test_the_beat_reports_the_stage_the_job_has_reached(storage_root, brisk):
    """It re-stamps rather than inventing: only the timestamp is new."""
    job = "c" * 32
    at = {"stage": "extracting"}
    ingest.write_status(job, state=ingest.RUNNING, stage="extracting", message="unpacking")

    with ingest._heartbeat(job, lambda: (at["stage"], "working")):
        time.sleep(0.15)
        at["stage"] = "publishing"
        time.sleep(0.15)

    assert ingest.read_status(job)["stage"] == "publishing"


# ---- A dead job still dies ----------------------------------------------------


def test_staleness_still_fires_once_the_beat_stops(storage_root, brisk):
    """The heartbeat must not defeat the detection it exists to make honest."""
    job = "d" * 32
    with ingest._heartbeat(job, lambda: ("converting", "working")):
        time.sleep(0.15)

    time.sleep(ingest.STALE_AFTER_SECONDS * 2)
    assert ingest.read_status(job)["state"] == ingest.FAILED


def test_the_beat_stops_before_the_caller_writes_a_terminal_status(storage_root, brisk):
    """A beat landing after DONE would put RUNNING back over it."""
    job = "e" * 32
    with ingest._heartbeat(job, lambda: ("publishing", "working")):
        time.sleep(0.15)
    ingest.write_status(job, state=ingest.DONE, stage="done", message="ready", run="x")

    time.sleep(0.2)
    assert ingest.read_status(job)["state"] == ingest.DONE


def test_no_job_id_means_no_thread(storage_root):
    """The command-line path has no job to report to and must not start one."""
    import threading

    before = threading.active_count()
    with ingest._heartbeat(None, lambda: ("x", "y")):
        assert threading.active_count() == before


# ---- Status writes leave no gap ------------------------------------------------


def test_a_status_update_is_never_momentarily_absent(storage_root):
    """delete-then-save left a window in which a poll read 'no such upload job'.

    Entered on every update, and the heartbeat multiplies updates by the length of the job,
    so a rare wrong answer would have become a common one.
    """
    job = "f" * 32
    ingest.write_status(job, state=ingest.RUNNING, stage="one", message="a")
    backend = run_store.storage()
    path = backend.path(ingest.status_key(job))

    seen = []
    for index in range(40):
        ingest.write_status(job, state=ingest.RUNNING, stage=f"s{index}", message="a")
        seen.append(os.path.exists(path))
    assert all(seen)


def test_a_replaced_status_leaves_no_stray_files(storage_root):
    """FileSystemStorage.save invents status_a1b2.json rather than overwriting."""
    job = "g" * 32
    for index in range(5):
        ingest.write_status(job, state=ingest.RUNNING, stage=f"s{index}", message="a")

    directory = os.path.dirname(run_store.storage().path(ingest.status_key(job)))
    assert sorted(os.listdir(directory)) == ["status.json"]


def test_the_written_status_is_always_complete_json(storage_root):
    """A torn write would parse as nothing and read as a missing job."""
    job = "h" * 32
    ingest.write_status(job, state=ingest.RUNNING, stage="converting", message="working")
    path = run_store.storage().path(ingest.status_key(job))
    with open(path) as handle:
        assert json.load(handle)["stage"] == "converting"


# ---- Wired into the pipeline, not just available ------------------------------


def test_publish_beats_while_a_stage_is_slow(storage_root, brisk, monkeypatch):
    """The helper working proves nothing if publish does not wrap the stages in it.

    _run stands in for the real stages here because the thing under test is the wiring: a
    stage that takes longer than the stale window must leave the job readable as running.
    """
    job = "i" * 32
    ingest.write_status(job, state=ingest.PENDING, stage="queued", message="queued")
    observed = {}

    def slow(archive_path, run_name, workspace, say):
        say("converting", "converting outputs to parquet")
        time.sleep(ingest.STALE_AFTER_SECONDS * 2.5)
        observed["status"] = ingest.read_status(job)
        return run_name

    monkeypatch.setattr(ingest, "_run", slow)
    monkeypatch.setattr(ingest, "is_valid_name", lambda name: True)
    monkeypatch.setattr(ingest.run_store, "find", lambda name: None)

    assert ingest.publish("ignored.tar", "gage-99", job_id=job) == "gage-99"
    assert observed["status"]["state"] == ingest.RUNNING
    assert observed["status"]["stage"] == "converting"


def test_publish_without_a_job_still_works(storage_root, brisk, monkeypatch):
    """The management-command path passes no job id and must not require one."""
    monkeypatch.setattr(ingest, "_run", lambda *a: "gage-99")
    monkeypatch.setattr(ingest, "is_valid_name", lambda name: True)
    monkeypatch.setattr(ingest.run_store, "find", lambda name: None)

    assert ingest.publish("ignored.tar", "gage-99") == "gage-99"
