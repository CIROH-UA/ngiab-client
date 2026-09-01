"""Two uploads of one name cannot publish into the same prefix.
The claim is a conditional PutObject, pinned even on a store that cannot enforce the condition."""

import json
import time

import pytest

from tethysapp.ngiab import run_store


class _Client:
    """A store that implements If-None-Match, and records what it was asked."""

    def __init__(self, existing=None, supports_condition=True):
        self.objects = dict(existing or {})
        self.supports_condition = supports_condition
        self.deleted = []

    def put_object(self, Bucket, Key, Body, IfNoneMatch=None):  # noqa: N803 - boto3's names
        if IfNoneMatch == "*" and self.supports_condition and Key in self.objects:
            raise _precondition_failed()
        if IfNoneMatch is not None and not self.supports_condition:
            raise _not_implemented()
        self.objects[Key] = Body
        return {}

    def get_object(self, Bucket, Key):  # noqa: N803
        if Key not in self.objects:
            raise KeyError(Key)
        return {"Body": _Body(self.objects[Key])}

    def delete_object(self, Bucket, Key):  # noqa: N803
        self.deleted.append(Key)
        self.objects.pop(Key, None)
        return {}


class _Body:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return self._payload


def _precondition_failed():
    error = Exception("At least one of the pre-conditions you specified did not hold")
    error.response = {"Error": {"Code": "PreconditionFailed"},
                      "ResponseMetadata": {"HTTPStatusCode": 412}}
    return error


def _not_implemented():
    error = Exception("A header you provided implies functionality that is not implemented")
    error.response = {"Error": {"Code": "NotImplemented"},
                      "ResponseMetadata": {"HTTPStatusCode": 501}}
    return error


@pytest.fixture
def hosted(monkeypatch):
    from tethysapp.ngiab import duckdb_conn

    monkeypatch.setenv(duckdb_conn.STORAGE_BACKEND_ENV, "s3")
    yield
    run_store.clear_caches()


@pytest.fixture
def local(monkeypatch):
    from tethysapp.ngiab import duckdb_conn

    monkeypatch.delenv(duckdb_conn.STORAGE_BACKEND_ENV, raising=False)


def _backend(client, location=""):
    from types import SimpleNamespace

    return SimpleNamespace(
        bucket_name="b",
        location=location,
        connection=SimpleNamespace(meta=SimpleNamespace(client=client)),
    )


def test_a_free_name_is_claimed_and_released(hosted, monkeypatch):
    client = _Client()
    monkeypatch.setattr(run_store, "storage", lambda: _backend(client))

    with run_store.claimed("gage-99"):
        assert "_uploads/claims/gage-99" in client.objects

    assert client.deleted == ["_uploads/claims/gage-99"]
    assert "_uploads/claims/gage-99" not in client.objects


def test_a_held_name_is_refused(hosted, monkeypatch):
    """The whole point: the second publisher is told no rather than interleaving."""
    client = _Client()
    monkeypatch.setattr(run_store, "storage", lambda: _backend(client))

    with run_store.claimed("gage-99"):
        with pytest.raises(run_store.ClaimHeld, match="already publishing"):
            with run_store.claimed("gage-99"):
                pass


def test_the_claim_is_released_even_when_the_body_raises(hosted, monkeypatch):
    """Otherwise one failed upload blocks the name until a stale claim expires."""
    client = _Client()
    monkeypatch.setattr(run_store, "storage", lambda: _backend(client))

    with pytest.raises(RuntimeError):
        with run_store.claimed("gage-99"):
            raise RuntimeError("conversion failed")

    assert "_uploads/claims/gage-99" not in client.objects


def test_different_names_do_not_block_each_other(hosted, monkeypatch):
    client = _Client()
    monkeypatch.setattr(run_store, "storage", lambda: _backend(client))

    with run_store.claimed("one"):
        with run_store.claimed("two"):
            assert len(client.objects) == 2


def test_the_claim_key_respects_the_bucket_prefix(hosted, monkeypatch):
    client = _Client()
    monkeypatch.setattr(run_store, "storage", lambda: _backend(client, location="media"))

    with run_store.claimed("gage-99"):
        assert "media/_uploads/claims/gage-99" in client.objects


def test_a_claim_is_not_listed_as_a_run(hosted):
    """Claims live under the reserved prefix, so they cannot appear in the picker."""
    assert run_store.is_reserved(run_store.CLAIM_DIR.split("/")[0]) is True


def test_a_store_without_conditional_writes_still_publishes(hosted, monkeypatch):
    """Degrading is better than refusing to publish on a store that works otherwise."""
    client = _Client(supports_condition=False)
    monkeypatch.setattr(run_store, "storage", lambda: _backend(client))

    with run_store.claimed("gage-99"):
        pass


def test_a_backend_with_no_client_still_publishes(hosted, monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setattr(run_store, "storage", lambda: SimpleNamespace(bucket_name="b"))
    with run_store.claimed("gage-99"):
        pass


def test_the_filesystem_backend_needs_no_claim(local, monkeypatch):
    """os.rename onto an existing directory fails, so the publish is the claim."""
    def explode():
        raise AssertionError("storage() should not be consulted on the local backend")

    monkeypatch.setattr(run_store, "storage", explode)
    with run_store.claimed("gage-99"):
        pass


def test_a_stale_claim_is_broken(hosted, monkeypatch):
    """A crashed publisher must not block the name forever."""
    from tethysapp.ngiab import ingest

    old = json.dumps({"run": "gage-99",
                      "claimed": time.time() - ingest.STALE_AFTER_SECONDS - 60}).encode()
    client = _Client(existing={"_uploads/claims/gage-99": old})
    monkeypatch.setattr(run_store, "storage", lambda: _backend(client))

    with run_store.claimed("gage-99"):
        assert "_uploads/claims/gage-99" in client.objects


def test_a_fresh_claim_is_not_broken(hosted, monkeypatch):
    fresh = json.dumps({"run": "gage-99", "claimed": time.time()}).encode()
    client = _Client(existing={"_uploads/claims/gage-99": fresh})
    monkeypatch.setattr(run_store, "storage", lambda: _backend(client))

    with pytest.raises(run_store.ClaimHeld):
        with run_store.claimed("gage-99"):
            pass


def test_an_unreadable_claim_is_not_assumed_abandoned(hosted, monkeypatch):
    """An unparseable claim is not evidence that its holder is gone."""
    client = _Client(existing={"_uploads/claims/gage-99": b"not json"})
    monkeypatch.setattr(run_store, "storage", lambda: _backend(client))

    with pytest.raises(run_store.ClaimHeld):
        with run_store.claimed("gage-99"):
            pass


def test_publish_refuses_a_name_another_upload_holds(hosted, monkeypatch, tmp_path):
    """The caller sees ArchiveRejected, which the endpoint turns into a message."""
    from tethysapp.ngiab import archive, ingest

    client = _Client()
    monkeypatch.setattr(run_store, "storage", lambda: _backend(client))
    monkeypatch.setattr(ingest, "is_valid_name", lambda name: True)

    with run_store.claimed("gage-99"):
        with pytest.raises(archive.ArchiveRejected, match="already publishing"):
            ingest.publish(str(tmp_path / "x.tar"), "gage-99")
