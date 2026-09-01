"""A refusal from storage must not read as a run with no data.
Absent stays absent; every other failure is raised rather than cached as empty."""

import json

import duckdb
import pytest
from django.contrib.auth.models import AnonymousUser
from django.test import RequestFactory

from tethysapp.ngiab import controllers, duckdb_conn, manifest, run_store


def _http(status, reason="Forbidden"):
    """Shaped like duckdb.HTTPException, which carries the store's status code."""
    exc = duckdb.HTTPException(f"HTTP Error: HTTP GET error (HTTP {status} {reason})")
    exc.status_code = status
    return exc


def test_a_404_is_a_missing_object():
    assert duckdb_conn.is_missing_error(_http(404, "Not Found")) is True


@pytest.mark.parametrize("status", [401, 403, 429, 500, 502, 503])
def test_anything_else_from_the_store_is_not_missing(status):
    """403 reading as 'absent' is the whole bug."""
    assert duckdb_conn.is_missing_error(_http(status)) is False


def test_a_glob_that_matched_nothing_locally_is_missing():
    exc = duckdb.IOException(
        'IO Error: No files found that match the pattern "/tmp/x/nope.parquet"'
    )
    assert duckdb_conn.is_missing_error(exc) is True


def test_an_unrecognised_local_error_is_not_missing():
    """Fails in the safe direction: reported, rather than silently empty."""
    exc = duckdb.IOException("IO Error: Could not resolve hostname for HTTP HEAD")
    assert duckdb_conn.is_missing_error(exc) is False


@pytest.fixture
def refusing(monkeypatch):
    def refuse(sql, parameters=None):
        raise _http(403)

    monkeypatch.setattr(duckdb_conn, "query", refuse)
    manifest.clear_caches()
    yield
    manifest.clear_caches()


@pytest.fixture
def absent(monkeypatch):
    def missing(sql, parameters=None):
        raise _http(404, "Not Found")

    monkeypatch.setattr(duckdb_conn, "query", missing)
    manifest.clear_caches()
    yield
    manifest.clear_caches()


def test_a_refused_catchment_sidecar_raises(refusing):
    with pytest.raises(run_store.StorageUnreachable):
        manifest.catchments("s3://bucket/prefix/run", "token")


def test_a_refused_crosswalk_raises(refusing):
    with pytest.raises(run_store.StorageUnreachable):
        manifest.crosswalk("s3://bucket/prefix/run", "token")


def test_a_refused_group_lookup_raises(refusing):
    with pytest.raises(run_store.StorageUnreachable):
        manifest.catchment_group("s3://bucket/prefix/run", "cat-1", "token")


def test_an_absent_catchment_sidecar_is_still_empty(absent):
    """A run distilled before the sidecars existed genuinely has none."""
    assert manifest.catchments("s3://bucket/prefix/run", "token") == []


def test_an_absent_crosswalk_is_still_empty(absent):
    """A run with no GeoPackage genuinely has no crosswalk."""
    assert manifest.crosswalk("s3://bucket/prefix/run", "token") == {}


def test_a_refusal_is_not_cached(monkeypatch):
    """The old empty answer was cached under the version token, so it outlived the outage."""
    manifest.clear_caches()
    calls = {"n": 0}

    def flaky(sql, parameters=None):
        calls["n"] += 1
        raise _http(403)

    monkeypatch.setattr(duckdb_conn, "query", flaky)
    for _ in range(3):
        with pytest.raises(run_store.StorageUnreachable):
            manifest.catchments("s3://bucket/prefix/run", "token")

    assert calls["n"] == 3, "a failure must not be remembered as an answer"
    manifest.clear_caches()


def test_recovery_needs_no_restart(monkeypatch):
    """Once storage is back, the next read succeeds -- it used to serve the cached empty."""
    import pandas

    manifest.clear_caches()
    state = {"broken": True}

    def flaky(sql, parameters=None):
        if state["broken"]:
            raise _http(403)
        return pandas.DataFrame({"catchment_id": ["cat-1"], "group_index": [0]})

    monkeypatch.setattr(duckdb_conn, "query", flaky)
    with pytest.raises(run_store.StorageUnreachable):
        manifest.catchments("s3://bucket/prefix/run", "token")

    state["broken"] = False
    assert manifest.catchments("s3://bucket/prefix/run", "token") == ["cat-1"]
    manifest.clear_caches()


def test_an_endpoint_reports_unreachable_storage_as_retryable(ingest, monkeypatch):
    """An endpoint reports unreachable storage as a retryable 503, not a 500 or an empty map."""
    run_id = ingest("alpha")

    def refuse(*args, **kwargs):
        raise run_store.StorageUnreachable("the bucket refused us")

    monkeypatch.setattr(controllers, "getCatchmentsList", refuse, raising=False)
    monkeypatch.setattr(
        "tethysapp.ngiab.controllers.run_bounds_4326",
        lambda *a, **k: (_ for _ in ()).throw(
            run_store.StorageUnreachable("the bucket refused us")
        ),
    )

    request = RequestFactory().get("/getGeoSpatialData/", {"model_run_id": run_id})
    request.user = AnonymousUser()
    response = controllers.getGeoSpatialData(request)

    assert response.status_code == 503
    assert "try again" in json.loads(response.content)["error"]


def test_an_ordinary_run_is_unaffected(ingest):
    """The guard must not change the answer for a run whose storage is fine."""
    run_id = ingest("beta")
    request = RequestFactory().get("/getGeoSpatialData/", {"model_run_id": run_id})
    request.user = AnonymousUser()
    response = controllers.getGeoSpatialData(request)

    assert response.status_code == 200
    assert json.loads(response.content)["catchments"] == ["cat-100", "cat-101", "cat-102"]
