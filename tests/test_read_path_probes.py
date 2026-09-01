"""The read path no longer probes the filesystem to answer a request.
Only calls with no object-store answer are banned; open() and exists() still work."""

import glob as glob_module
import os
import sqlite3

import pyogrio
import pytest

from tethysapp.ngiab import utils as ngiab_utils

BANNED = ("stat", "listdir", "scandir", "walk")


@pytest.fixture
def probe_log(monkeypatch):
    """Record every banned filesystem call made while the block runs."""
    calls = []

    for name in BANNED:
        real = getattr(os, name)

        def watcher(*args, _name=name, _real=real, **kwargs):
            calls.append((_name, args[0] if args else None))
            return _real(*args, **kwargs)

        monkeypatch.setattr(os, name, watcher)

    real_glob = glob_module.glob

    def watched_glob(pattern, *args, **kwargs):
        calls.append(("glob", pattern))
        return real_glob(pattern, *args, **kwargs)

    monkeypatch.setattr(glob_module, "glob", watched_glob)

    real_connect = sqlite3.connect

    def watched_connect(target, *args, **kwargs):
        calls.append(("sqlite3", target))
        return real_connect(target, *args, **kwargs)

    monkeypatch.setattr(sqlite3, "connect", watched_connect)

    real_read_info = pyogrio.read_info

    def watched_read_info(path, *args, **kwargs):
        calls.append(("pyogrio", path))
        return real_read_info(path, *args, **kwargs)

    monkeypatch.setattr(pyogrio, "read_info", watched_read_info)
    return calls


def _inside_a_run(calls, storage_root):
    """Calls that reach *into* a run directory, which is what this unit removed."""
    root = str(storage_root).rstrip("/")
    inside = []
    for name, target in calls:
        text = str(target or "")
        if not text.startswith(root + "/"):
            continue
        inside.append((name, text))
    return inside


def test_listing_catchments_probes_nothing(ingest, probe_log):
    run_id = ingest()
    probe_log.clear()

    assert ngiab_utils.getCatchmentsList(run_id) == ["cat-100", "cat-101", "cat-102"]
    assert _inside_a_run(probe_log, ingest.root) == []


def test_reading_catchment_variables_probes_nothing(ingest, probe_log):
    """This one used to glob the output directory to find out which format was present."""
    run_id = ingest()
    probe_log.clear()

    ngiab_utils.get_catchment_variables(run_id)
    assert _inside_a_run(probe_log, ingest.root) == []


def test_reading_one_catchment_series_probes_nothing(ingest, probe_log):
    """Was os.path.exists per candidate suffix, then a pandas read."""
    run_id = ingest()
    outputs = ngiab_utils.run_outputs(run_id)
    probe_log.clear()

    ngiab_utils._read_output_frame(outputs, "cat-100", ["Time", "Q_OUT"], time_column="Time")
    assert _inside_a_run(probe_log, ingest.root) == []


def test_building_the_value_matrix_probes_nothing(ingest, probe_log):
    """Was a glob for the format and a listdir for the catchment count."""
    run_id = ingest()
    probe_log.clear()

    matrix = ngiab_utils.get_catchment_value_matrix(run_id, "Q_OUT")
    assert matrix["catchment_ids"] == [100, 101, 102]
    assert _inside_a_run(probe_log, ingest.root) == []


def test_the_cache_key_is_not_an_os_stat(ingest, probe_log):
    """_output_fingerprint was os.stat(directory).st_mtime_ns, which is None on a prefix."""
    run_id = ingest()
    probe_log.clear()

    ngiab_utils.get_catchment_variables(run_id)
    assert [name for name, _ in _inside_a_run(probe_log, ingest.root) if name == "stat"] == []


def test_map_bounds_do_not_open_a_geopackage(ingest, probe_log):
    """A GeoPackage is SQLite, so this is not an optimisation -- it cannot be read on S3."""
    run_id = ingest()
    probe_log.clear()

    assert ngiab_utils.run_bounds_4326(run_id) is not None
    assert _inside_a_run(probe_log, ingest.root) == []


def test_the_flowpath_crosswalk_does_not_open_a_geopackage(ingest, probe_log):
    run_id = ingest()
    probe_log.clear()

    assert ngiab_utils.describe_troute_feature(run_id, 100) == ("wb-100", "cat-100")
    assert [name for name, _ in probe_log if name in ("sqlite3", "pyogrio")] == []


def test_many_features_do_not_reopen_anything(ingest, probe_log):
    """The crosswalk is cached whole, so reading many features does not reopen the GeoPackage."""
    run_id = ingest()
    ngiab_utils.describe_troute_feature(run_id, 100)
    probe_log.clear()

    for _ in range(40):
        for feature in (100, 101, 102):
            ngiab_utils.describe_troute_feature(run_id, feature)

    assert [name for name, _ in probe_log if name in ("sqlite3", "pyogrio")] == []


def test_teehr_presence_comes_from_the_manifest(ingest, probe_log):
    """TEEHR presence is read from the manifest, not from os.path.isdir against an s3:// path."""
    run_id = ingest()
    probe_log.clear()

    reader, _config = ngiab_utils.teehr_source(run_id)
    assert reader is None
    assert _inside_a_run(probe_log, ingest.root) == []


def test_reading_troute_probes_nothing(ingest, probe_log):
    """The assertion Unit 9 deferred. get_troute_df used to glob for *.csv then *.nc."""
    run_id = ingest()
    probe_log.clear()

    assert ngiab_utils.get_troute_df(run_id) is not None
    assert _inside_a_run(probe_log, ingest.root) == []


def test_no_read_endpoint_probes_anything(ingest, probe_log):
    """No read a chart load makes reaches into a run directory with a call an object store can't answer."""
    run_id = ingest()
    probe_log.clear()

    ngiab_utils.getCatchmentsList(run_id)
    ngiab_utils.get_catchment_variables(run_id)
    ngiab_utils.run_outputs(run_id)
    ngiab_utils.get_catchment_value_matrix(run_id, "Q_OUT")
    ngiab_utils.run_bounds_4326(run_id)
    ngiab_utils.describe_troute_feature(run_id, 100)
    frame = ngiab_utils.get_troute_df(run_id)
    ngiab_utils.get_troute_vars(frame)
    ngiab_utils.check_troute_id(frame, 100)

    assert _inside_a_run(probe_log, ingest.root) == []
