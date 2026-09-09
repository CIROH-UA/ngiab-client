"""The pieces of the hardening pass that shipped with no test at all.
Covers the DuckDB credential retry, missing-vs-unreachable classification, and batched delete."""

from types import SimpleNamespace

import duckdb
import pytest

from tethysapp.ngiab import duckdb_conn, run_store
from tethysapp.ngiab import utils as ngiab_utils


@pytest.fixture
def hosted(monkeypatch):
    monkeypatch.setenv(duckdb_conn.STORAGE_BACKEND_ENV, "s3")
    yield
    duckdb_conn.reset()


@pytest.fixture
def local(monkeypatch):
    monkeypatch.delenv(duckdb_conn.STORAGE_BACKEND_ENV, raising=False)


def _raiser(message, times=1):
    """A callable that fails with a DuckDB error the first `times` calls, then succeeds."""
    state = {"n": 0}

    def run():
        state["n"] += 1
        if state["n"] <= times:
            raise duckdb.Error(message)
        return "ok"

    run.calls = lambda: state["n"]
    return run


@pytest.mark.parametrize("message", [
    "HTTP 403 Forbidden",
    "HTTP 401",
    "ExpiredToken: the security token has expired",
    "InvalidAccessKeyId",
    "SignatureDoesNotMatch",
    "Access Denied",
])
def test_an_auth_failure_rebuilds_the_connection_and_retries_once(hosted, monkeypatch, message):
    """An auth failure rebuilds the DuckDB connection and retries the read once."""
    reset_calls = []
    monkeypatch.setattr(duckdb_conn, "reset", lambda: reset_calls.append(1))

    run = _raiser(message)
    assert duckdb_conn._with_fresh_credentials(run) == "ok"
    assert run.calls() == 2
    assert len(reset_calls) == 1


def test_a_non_auth_error_is_raised_without_a_rebuild(hosted, monkeypatch):
    """A missing object stays missing rather than triggering a retry to the same wrong answer."""
    reset_calls = []
    monkeypatch.setattr(duckdb_conn, "reset", lambda: reset_calls.append(1))

    run = _raiser("IO Error: No files found that match the pattern")
    with pytest.raises(duckdb.Error):
        duckdb_conn._with_fresh_credentials(run)
    assert run.calls() == 1
    assert reset_calls == []


def test_the_retry_never_fires_on_a_local_deployment(local, monkeypatch):
    reset_calls = []
    monkeypatch.setattr(duckdb_conn, "reset", lambda: reset_calls.append(1))

    run = _raiser("HTTP 403 Forbidden")
    with pytest.raises(duckdb.Error):
        duckdb_conn._with_fresh_credentials(run)
    assert run.calls() == 1
    assert reset_calls == []


def test_it_retries_only_once(hosted, monkeypatch):
    """Otherwise a genuinely revoked credential becomes an unbounded retry storm."""
    monkeypatch.setattr(duckdb_conn, "reset", lambda: None)
    run = _raiser("HTTP 403", times=2)
    with pytest.raises(duckdb.Error):
        duckdb_conn._with_fresh_credentials(run)
    assert run.calls() == 2


def _client_error(code):
    """Shaped like a botocore ClientError, which is what S3 raises for a missing key."""
    return SimpleNamespace(response={"Error": {"Code": code}})


@pytest.mark.parametrize("code", ["404", "NoSuchKey"])
def test_a_missing_key_reads_as_missing(code):
    assert run_store._is_missing(_client_error(code)) is True


def test_a_plain_filenotfound_reads_as_missing():
    assert run_store._is_missing(FileNotFoundError("gone")) is True


@pytest.mark.parametrize("code", ["403", "AccessDenied", "500", "SlowDown"])
def test_a_refusal_does_not_read_as_missing(code):
    """Reporting 'denied' as 'absent' is the silent-empty failure this module exists to avoid."""
    assert run_store._is_missing(_client_error(code)) is False


def test_an_error_with_no_response_does_not_read_as_missing():
    assert run_store._is_missing(RuntimeError("connection reset")) is False


def test_parquet_troute_is_readable_anywhere(hosted):
    assert ngiab_utils.troute_readable_here(".parquet") is True


@pytest.mark.parametrize("fmt", [".nc", ".csv", "", None])
def test_unconverted_troute_is_not_readable_from_object_storage(hosted, fmt):
    """xarray cannot open an s3:// URI at all, so this used to raise on every routing chart."""
    assert ngiab_utils.troute_readable_here(fmt) is False


@pytest.mark.parametrize("fmt", [".nc", ".csv", ".parquet"])
def test_every_format_is_readable_from_a_filesystem(local, fmt):
    assert ngiab_utils.troute_readable_here(fmt) is True


def test_an_unconverted_run_returns_no_frame_instead_of_raising(ingest, monkeypatch):
    """The endpoint's own 'no routing output' path is a far better answer than a traceback."""
    run_id = ingest("unconverted", troute="nc")
    monkeypatch.setenv(duckdb_conn.STORAGE_BACKEND_ENV, "s3")
    run_store.clear_caches()

    assert ngiab_utils.get_troute_df(run_id) is None


class _Client:
    def __init__(self, errors=None):
        self.batches = []
        self.errors = errors or []

    def delete_objects(self, Bucket, Delete):  # noqa: N803 - boto3's own parameter names
        self.batches.append([o["Key"] for o in Delete["Objects"]])
        return {"Errors": self.errors}


class _Backend:
    def __init__(self, keys, client=None, bucket="b", location=""):
        self._keys = list(keys)
        self.bucket_name = bucket
        self.location = location
        self.deleted = []
        if client is not None:
            self.connection = SimpleNamespace(meta=SimpleNamespace(client=client))

    def listdir(self, prefix):
        head = f"{prefix}/" if prefix else ""
        directories, files = set(), []
        for key in self._keys:
            if not key.startswith(head):
                continue
            rest = key[len(head):]
            if "/" in rest:
                directories.add(rest.split("/", 1)[0])
            else:
                files.append(rest)
        return sorted(directories), files

    def delete(self, key):
        self.deleted.append(key)


def test_deletion_walks_nested_prefixes():
    """The recursion only runs if listdir reports subdirectories, which the real one does."""
    backend = _Backend(["run/a.txt", "run/outputs/ngen/b.parquet", "run/config/c.json"])
    run_store.delete_prefix(backend, "run")
    assert sorted(backend.deleted) == [
        "run/a.txt", "run/config/c.json", "run/outputs/ngen/b.parquet",
    ]


def test_deletion_batches_through_the_client_when_there_is_one():
    client = _Client()
    keys = [f"run/outputs/ngen/cat-{i}.csv" for i in range(2500)]
    backend = _Backend(keys, client=client)

    run_store.delete_prefix(backend, "run")

    assert [len(batch) for batch in client.batches] == [1000, 1000, 500]
    assert backend.deleted == [], "the per-key fallback should not also run"


def test_batched_keys_carry_the_backend_location():
    client = _Client()
    backend = _Backend(["run/a.txt"], client=client, location="media")
    run_store.delete_prefix(backend, "run")
    assert client.batches == [["media/run/a.txt"]]


def test_a_partial_delete_failure_is_raised_not_swallowed():
    """Quiet=True hides the successes, not the errors -- but only if the response is read."""
    client = _Client(errors=[{"Key": "run/a.txt", "Code": "AccessDenied"}])
    backend = _Backend(["run/a.txt"], client=client)

    with pytest.raises(run_store.StorageUnreachable, match="could not be deleted"):
        run_store.delete_prefix(backend, "run")


def test_deleting_an_explicit_key_list_does_not_list_the_prefix():
    """Ingest cleanup passes what it wrote, so it cannot sweep a concurrent upload's objects."""
    client = _Client()
    backend = _Backend(["run/mine.txt", "run/theirs.txt"], client=client)

    run_store.delete_prefix(backend, "run", keys=["run/mine.txt"])
    assert client.batches == [["run/mine.txt"]]
