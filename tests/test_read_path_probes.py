"""The read path no longer probes the filesystem to answer a request.

Read docs/plans/2026-08-22-001-feat-storage-backed-model-runs-plan.md, Unit 9.

This is the unit's actual claim, and it needs asserting rather than reasoning about, because
every probe it removes is individually harmless and collectively the reason a hosted run
cannot be served. Each one either does not work against an object store (``os.walk``,
``os.listdir``, ``sqlite3`` on a GeoPackage) or silently returns the wrong answer there
(``os.stat`` for a cache key returns None, so the key never changes and a re-ingested run
serves stale bins forever).

**What is allowed.** ``open()`` and ``os.path.exists`` are not banned: reading a manifest and
its sidecars is what replaced the probes, and locally those are files. Under object storage
they go through the storage interface instead. What is banned is the specific set of calls
that have no object-store answer at all.

**Troute is deliberately out of scope.** ``get_troute_df`` still globs and still opens a
NetCDF; converting it is Unit 11, which is where the unrestricted version of this assertion
belongs. Scoping it here rather than weakening it there is the difference between a check
that means something and one that gets quietly relaxed.
"""

import glob as glob_module
import os
import sqlite3

import pyogrio
import pytest

from tethysapp.ngiab import utils as ngiab_utils

# Calls with no object-store equivalent. Each was on a request path before this unit.
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
    """Calls that reach *into* a run directory, which is what this unit removed.

    Listing the storage root itself is excluded deliberately. That is the registry operation
    -- one LIST against an object store, through the storage interface -- and it is the thing
    that replaced the database query, not a probe of a run's contents. What had to go is
    everything below it: walking a run's config directory, listing its outputs, statting it
    for a cache key, opening its GeoPackage.

    Django and DuckDB stat plenty of their own files; only paths under the root count.
    """
    root = str(storage_root).rstrip("/")
    inside = []
    for name, target in calls:
        text = str(target or "")
        if not text.startswith(root + "/"):
            continue
        inside.append((name, text))
    return inside


# ---- The catchment endpoints ------------------------------------------------


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


# ---- The GeoPackage is never opened -----------------------------------------


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
    """The old reader was lru_cache(32) per feature, so the 33rd click re-opened the gpkg.

    The crosswalk is cached whole now, keyed on the version token, so feature count stops
    mattering.
    """
    run_id = ingest()
    ngiab_utils.describe_troute_feature(run_id, 100)
    probe_log.clear()

    for _ in range(40):
        for feature in (100, 101, 102):
            ngiab_utils.describe_troute_feature(run_id, feature)

    assert [name for name, _ in probe_log if name in ("sqlite3", "pyogrio")] == []


# ---- TEEHR --------------------------------------------------------------------


def test_teehr_presence_comes_from_the_manifest(ingest, probe_log):
    """evaluation_dir's os.path.isdir is False for every s3:// path, whatever is in the bucket.

    Without the manifest answering this, a hosted run reports "no TEEHR evaluation" while its
    parquet sits there readable.
    """
    run_id = ingest()
    probe_log.clear()

    reader, _config = ngiab_utils.teehr_source(run_id)
    assert reader is None
    assert _inside_a_run(probe_log, ingest.root) == []


# ---- The scope boundary, stated ------------------------------------------------


def test_troute_still_probes_and_that_is_unit_11(ingest, probe_log):
    """Recorded rather than skipped, so the gap is visible and dated.

    get_troute_df globs for *.csv then *.nc and opens whichever it finds. Unit 11 converts it
    and takes on the unrestricted version of this assertion.
    """
    run_id = ingest()
    probe_log.clear()

    ngiab_utils.get_troute_df(run_id)
    assert [name for name, _ in _inside_a_run(probe_log, ingest.root) if name == "glob"]
