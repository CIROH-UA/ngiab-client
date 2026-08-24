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
import threading
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

    with ingest._heartbeat(job, lambda: {"stage": "converting", "message": "working"}):
        time.sleep(0.3)

    later = ingest.read_status(job)
    assert later["state"] == ingest.RUNNING, "a beating job must not read as failed"
    assert later["updated"] > first


def test_a_stage_longer_than_the_stale_window_is_not_declared_dead(storage_root, brisk):
    """Sleeping well past STALE_AFTER_SECONDS, which is what used to kill a big conversion."""
    job = "b" * 32
    ingest.write_status(job, state=ingest.RUNNING, stage="converting", message="working")

    with ingest._heartbeat(job, lambda: {"stage": "converting", "message": "working"}):
        time.sleep(ingest.STALE_AFTER_SECONDS * 2.5)
        during = ingest.read_status(job)

    assert during["state"] == ingest.RUNNING
    assert "stopped responding" not in (during["message"] or "")


def test_the_beat_reports_the_stage_the_job_has_reached(storage_root, brisk):
    """It re-stamps rather than inventing: only the timestamp is new."""
    job = "c" * 32
    at = {"stage": "extracting"}
    ingest.write_status(job, state=ingest.RUNNING, stage="extracting", message="unpacking")

    with ingest._heartbeat(job, lambda: {"stage": at["stage"], "message": "working"}):
        time.sleep(0.15)
        at["stage"] = "publishing"
        time.sleep(0.15)

    assert ingest.read_status(job)["stage"] == "publishing"


# ---- A dead job still dies ----------------------------------------------------


def test_staleness_still_fires_once_the_beat_stops(storage_root, brisk):
    """The heartbeat must not defeat the detection it exists to make honest."""
    job = "d" * 32
    with ingest._heartbeat(job, lambda: {"stage": "converting", "message": "working"}):
        time.sleep(0.15)

    time.sleep(ingest.STALE_AFTER_SECONDS * 2)
    assert ingest.read_status(job)["state"] == ingest.FAILED


def test_the_thread_is_stopped_by_the_time_the_block_exits(storage_root, brisk):
    """Asserted on the thread, not on a timing coincidence.

    The earlier version wrote DONE after the block and checked it survived -- which holds
    whether or not the join is there, because __exit__ joins synchronously. Naming the
    thread lets this fail if the join is ever dropped.
    """
    job = "e" * 32
    with ingest._heartbeat(job, lambda: {"stage": "publishing", "message": "working"}):
        time.sleep(0.15)
        assert any(t.name.endswith(job) for t in threading.enumerate())

    assert not any(t.name.endswith(job) for t in threading.enumerate())


def test_a_late_beat_cannot_undo_a_finished_job(storage_root, brisk, monkeypatch):
    """The guarantee that does not depend on the join landing in time.

    join() takes a timeout and a beat inside a slow write outlives it, so ordering alone is
    not enough. A beat is forced to run after DONE is written and must decline.
    """
    job = "j" * 32
    ingest.write_status(job, state=ingest.DONE, stage="done", message="ready", run="x")

    ingest.write_status(job, only_if_running=True, state=ingest.RUNNING,
                        stage="publishing", message="late", run="x")

    after = ingest.read_status(job)
    assert after["state"] == ingest.DONE
    assert after["message"] == "ready"


def test_a_running_job_is_still_re_stamped(storage_root, brisk):
    """The guard must not stop the heartbeat doing its job."""
    job = "k" * 32
    ingest.write_status(job, state=ingest.RUNNING, stage="converting", message="a")
    first = ingest.read_status(job)["updated"]
    time.sleep(0.02)

    ingest.write_status(job, only_if_running=True, state=ingest.RUNNING,
                        stage="converting", message="a")
    assert ingest.read_status(job)["updated"] > first


def test_no_job_id_means_no_thread(storage_root):
    """The command-line path has no job to report to and must not start one."""
    import threading

    before = threading.active_count()
    with ingest._heartbeat(None, lambda: {"stage": "x", "message": "y"}):
        assert threading.active_count() == before


# ---- Status writes leave no gap ------------------------------------------------


def test_a_status_update_is_never_momentarily_absent(storage_root):
    """delete-then-save left a window in which a poll read 'no such upload job'.

    Entered on every update, and the heartbeat multiplies updates by the length of the job,
    so a rare wrong answer would have become a common one.

    The reader runs in its own thread, because that is the only way this can fail. Checking
    after each write returns -- which is what this test did first -- passes just as happily
    against delete-then-save, since the file is back by the time the call returns. A test
    that cannot fail against the implementation it names is worse than no test.
    """
    job = "f" * 32
    ingest.write_status(job, state=ingest.RUNNING, stage="one", message="a")
    path = run_store.storage().path(ingest.status_key(job))

    missing = []
    stop = threading.Event()

    def watch():
        while not stop.is_set():
            if not os.path.exists(path):
                missing.append(time.time())

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    try:
        for index in range(200):
            ingest.write_status(job, state=ingest.RUNNING, stage=f"s{index}", message="a")
    finally:
        stop.set()
        watcher.join(timeout=5)

    assert missing == [], f"status vanished {len(missing)} times mid-update"


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

    monkeypatch.setattr(ingest, "_run_stages", slow)
    monkeypatch.setattr(ingest, "is_valid_name", lambda name: True)
    monkeypatch.setattr(ingest.run_store, "find", lambda name: None)

    assert ingest.publish("ignored.tar", "gage-99", job_id=job) == "gage-99"
    assert observed["status"]["state"] == ingest.RUNNING
    assert observed["status"]["stage"] == "converting"


def test_publish_without_a_job_still_works(storage_root, brisk, monkeypatch):
    """The management-command path passes no job id and must not require one."""
    monkeypatch.setattr(ingest, "_run_stages", lambda *a: "gage-99")
    monkeypatch.setattr(ingest, "is_valid_name", lambda name: True)
    monkeypatch.setattr(ingest.run_store, "find", lambda name: None)

    assert ingest.publish("ignored.tar", "gage-99") == "gage-99"


# ---- The interval formula itself ----------------------------------------------

# Every test above replaces heartbeat_seconds, so without these the real body is never run.


@pytest.mark.parametrize("stale,expected", [
    (0.2, 0.05), (1, 0.25), (2, 0.5), (60, 15.0), (240, 60.0), (1800, 60.0), (7200, 60.0),
])
def test_the_interval_is_a_quarter_of_the_window_capped_at_a_minute(monkeypatch, stale,
                                                                    expected):
    monkeypatch.setattr(ingest, "STALE_AFTER_SECONDS", float(stale))
    assert ingest.heartbeat_seconds() == pytest.approx(expected)


@pytest.mark.parametrize("stale", [0.2, 1, 2, 60, 240, 1800, 7200])
def test_the_beat_always_fits_several_times_into_the_window(monkeypatch, stale):
    """A floor that exceeded the window would defeat the heartbeat in exactly the tight
    configuration that most wants it -- which a whole-second floor used to do."""
    monkeypatch.setattr(ingest, "STALE_AFTER_SECONDS", float(stale))
    assert stale / ingest.heartbeat_seconds() >= 4


# ---- A beat that cannot report ------------------------------------------------


def test_a_raising_snapshot_does_not_kill_the_beat(storage_root, brisk):
    """A thread that dies on one bad read stops reporting, which is the bug, not the fix."""
    job = "m" * 32
    ingest.write_status(job, state=ingest.RUNNING, stage="converting", message="a")
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient")
        return {"stage": "converting", "message": "a", "run": "x"}

    with ingest._heartbeat(job, flaky):
        time.sleep(0.3)

    assert calls["n"] > 2, "the beat stopped after the first failure"
    assert ingest.read_status(job)["state"] == ingest.RUNNING


def test_a_failing_write_does_not_kill_the_beat(storage_root, brisk, monkeypatch):
    job = "n" * 32
    calls = {"n": 0}
    real = ingest.write_status

    def flaky(job_id, **kwargs):
        calls["n"] += 1
        if calls["n"] < 3:
            raise OSError("storage said no")
        return real(job_id, **kwargs)

    monkeypatch.setattr(ingest, "write_status", flaky)
    with ingest._heartbeat(job, lambda: {"stage": "x", "message": "y", "run": "z"}):
        time.sleep(0.3)

    assert calls["n"] > 3


# ---- The object-storage branch of _replace -------------------------------------


def test_a_backend_without_a_filesystem_path_is_saved_through_the_storage_api():
    """S3Storage.path raises NotImplementedError -- every Storage defines path(), so that
    raise is the discrimination, not a hasattr check."""
    saved = {}

    class Bucketed:
        def path(self, key):
            raise NotImplementedError

        def save(self, key, content):
            saved[key] = content.read()
            return key

    ingest._replace(Bucketed(), "k/status.json", b'{"a": 1}')
    assert saved == {"k/status.json": b'{"a": 1}'}


def test_a_write_failure_leaves_no_temporary_file(storage_root, monkeypatch):
    """The temp file is created before the replace; a failure between the two must not
    leave litter in a directory nothing sweeps."""
    job = "p" * 32
    ingest.write_status(job, state=ingest.RUNNING, stage="a", message="b")
    directory = os.path.dirname(run_store.storage().path(ingest.status_key(job)))

    def boom(src, dst):
        raise OSError("no")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        ingest._replace(run_store.storage(), ingest.status_key(job), b"{}")

    assert [n for n in os.listdir(directory) if n.endswith(".tmp")] == []


# ---- A stage that fails while the beat runs -------------------------------------


def test_a_failing_stage_still_stops_the_beat(storage_root, brisk, monkeypatch):
    """The heartbeat must not outlive a job that raised, or it re-stamps a dead one."""
    job = "q" * 32

    def explode(archive_path, run_name, workspace, say):
        say("converting", "converting outputs to parquet")
        raise ingest.IngestError("conversion failed")

    monkeypatch.setattr(ingest, "_run_stages", explode)
    monkeypatch.setattr(ingest, "is_valid_name", lambda name: True)
    monkeypatch.setattr(ingest.run_store, "find", lambda name: None)

    with pytest.raises(ingest.IngestError):
        ingest.publish("ignored.tar", "gage-99", job_id=job)

    assert not any(t.name.endswith(job) for t in threading.enumerate())
