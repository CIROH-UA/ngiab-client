"""Listing runs from a storage root, local or object store.

Read docs/plans/2026-08-22-001-feat-storage-backed-model-runs-plan.md, Unit 4.

The load-bearing claim is that the two backends are indistinguishable to everything above
them, so most tests here run twice: once against a real ``FileSystemStorage`` over a
temporary directory, and once against an in-memory fake standing in for S3. The fake is
deliberately not a mock of boto3 -- what needs proving is that ``run_store`` depends on the
Django storage interface and nothing else. Whether ``S3Storage`` itself works against a real
bucket is an integration question this unit cannot answer offline, and the plan keeps it as a
spike.

Nothing here consults ``_get_list_model_runs``. Wiring this into the registry is Unit 5.
"""

import io
import os

import pytest
from django.core.files.storage import Storage

from tethysapp.ngiab import manifest, run_store


class InMemoryStorage(Storage):
    """The smallest thing that behaves like an object store for run_store's purposes.

    Object stores have no directories -- ``listdir`` derives them from key prefixes, which is
    exactly what ``Delimiter="/"`` does against S3. Modelling that here rather than faking a
    filesystem is the point: a run_store that accidentally depends on real directories would
    pass against FileSystemStorage and fail in a bucket.
    """

    #: A real S3Storage always names a bucket, so the fake does too -- run_store builds a
    #: run's s3:// location from it, and a fake without one is not faking the same thing.
    bucket_name = "runs-bucket"
    location = ""

    def __init__(self, objects=None, fail_with=None):
        self._objects = dict(objects or {})
        self._fail_with = fail_with

    def listdir(self, path):
        if self._fail_with:
            raise self._fail_with
        prefix = f"{path.rstrip('/')}/" if path.strip("/") else ""
        directories, files = set(), []
        for key in self._objects:
            if not key.startswith(prefix):
                continue
            remainder = key[len(prefix):]
            head, _, tail = remainder.partition("/")
            if tail:
                directories.add(head)
            else:
                files.append(head)
        return sorted(directories), sorted(files)

    def exists(self, name):
        if self._fail_with:
            raise self._fail_with
        return name in self._objects

    def _open(self, name, mode="rb"):
        if self._fail_with:
            raise self._fail_with
        if name not in self._objects:
            raise FileNotFoundError(name)
        return io.BytesIO(self._objects[name])

    def _save(self, name, content):
        self._objects[name] = content.read()
        return name


def _publish(run_path, into, prefix):
    """Copy a generated run's manifest files into an object-store-shaped dict."""
    for name in (
        manifest.MANIFEST_NAME,
        manifest.CATCHMENTS_SIDECAR,
        manifest.CROSSWALK_SIDECAR,
    ):
        source = os.path.join(run_path, name)
        if os.path.exists(source):
            with open(source, "rb") as handle:
                into[f"{prefix}/{name}"] = handle.read()


@pytest.fixture
def local_root(tmp_path, mini_run_factory, monkeypatch):
    """Two ingested runs on a real filesystem, with the storage root pointed at them."""
    root = tmp_path / "ngiab_visualizer"
    root.mkdir()
    for name, created in (("alpha", "2026-08-01T00:00:00+00:00"), ("beta", "2026-08-20T00:00:00+00:00")):
        run = mini_run_factory(name=f"src-{name}")
        document = manifest.distill(run, label=name, created=created)
        manifest.write(run, document)
        os.rename(run, root / name)

    monkeypatch.delenv(run_store.duckdb_conn.STORAGE_BACKEND_ENV, raising=False)
    monkeypatch.setenv(run_store.MANAGED_ROOT_ENV, str(root))
    run_store.clear_caches()
    return str(root)


@pytest.fixture
def object_root(tmp_path, mini_run_factory, monkeypatch):
    """The same two runs, as keys in an object store."""
    objects = {}
    for name, created in (("alpha", "2026-08-01T00:00:00+00:00"), ("beta", "2026-08-20T00:00:00+00:00")):
        run = mini_run_factory(name=f"obj-{name}")
        manifest.write(run, manifest.distill(run, label=name, created=created))
        _publish(run, objects, name)

    storage = InMemoryStorage(objects)
    monkeypatch.setenv(run_store.duckdb_conn.STORAGE_BACKEND_ENV, "s3")
    monkeypatch.setattr(run_store, "storage", lambda: storage)
    run_store.clear_caches()
    return storage


# ---- The local root is the mount that already exists -----------------------


def test_local_root_defaults_to_the_existing_run_mount(monkeypatch):
    """Not MEDIA_ROOT.

    MEDIA_ROOT resolves to an unmounted $TETHYS_PERSIST_PATH/media, while every existing run
    lives in ngiab_visualizer, which viewOnTethys.sh already bind-mounts. Rooting the store
    at MEDIA_ROOT would put every existing run outside the root -- an image upgrade that
    empties the picker with no recovery path, since register_run is gone by Unit 8.
    """
    monkeypatch.delenv(run_store.MANAGED_ROOT_ENV, raising=False)
    assert run_store.local_root() == "/var/lib/tethys_persist/ngiab_visualizer"


def test_local_root_is_overridable(monkeypatch):
    monkeypatch.setenv(run_store.MANAGED_ROOT_ENV, "/somewhere/else")
    assert run_store.local_root() == "/somewhere/else"


# ---- Listing behaves the same either way -----------------------------------


def test_local_listing_returns_one_entry_per_run(local_root):
    names = [entry["name"] for entry in run_store.list_runs()]
    assert sorted(names) == ["alpha", "beta"]


def test_object_listing_returns_the_same_entries(object_root):
    names = [entry["name"] for entry in run_store.list_runs()]
    assert sorted(names) == ["alpha", "beta"]


def test_both_backends_order_newest_first(local_root):
    """Meta.ordering was ["-created", "label"]; a listing is lexicographic.

    Without this the default-selected run changes on every fresh visit, which is a
    user-visible regression no payload-shape assertion would catch.
    """
    assert [entry["name"] for entry in run_store.list_runs()] == ["beta", "alpha"]


def test_object_backend_orders_newest_first(object_root):
    assert [entry["name"] for entry in run_store.list_runs()] == ["beta", "alpha"]


def test_entries_carry_the_hot_manifest(local_root):
    entry = run_store.list_runs()[0]
    assert entry["manifest"]["label"] == "beta"
    assert entry["manifest"]["catchment_count"] == 3
    assert entry["usable"] is True
    assert entry["reason"] is None


# ---- Empty and unusable ----------------------------------------------------


def test_empty_root_returns_an_empty_list(tmp_path, monkeypatch):
    monkeypatch.delenv(run_store.duckdb_conn.STORAGE_BACKEND_ENV, raising=False)
    monkeypatch.setenv(run_store.MANAGED_ROOT_ENV, str(tmp_path / "nothing-here"))
    run_store.clear_caches()
    assert run_store.list_runs() == []


def test_directory_without_a_manifest_is_reported_not_hidden(local_root):
    """Mirrors describe_importable_run: a directory the user can see on disk and cannot see
    in the interface is indistinguishable from a bug.
    """
    os.mkdir(os.path.join(local_root, "not-a-run"))
    run_store.clear_caches()

    entries = {entry["name"]: entry for entry in run_store.list_runs()}
    assert "not-a-run" in entries
    assert entries["not-a-run"]["usable"] is False
    assert "write_manifest" in entries["not-a-run"]["reason"]


def test_run_without_outputs_is_reported_with_a_reason(local_root):
    """A manifest that records no output format means there is nothing to plot."""
    run = os.path.join(local_root, "alpha")
    for name in os.listdir(os.path.join(run, "outputs", "ngen")):
        os.remove(os.path.join(run, "outputs", "ngen", name))
    manifest.write(run, manifest.distill(run, label="alpha"))
    run_store.clear_caches()

    entries = {entry["name"]: entry for entry in run_store.list_runs()}
    assert entries["alpha"]["usable"] is False
    assert "nothing to plot" in entries["alpha"]["reason"]


# ---- Failures are distinguishable from emptiness ---------------------------


def test_unreachable_backend_raises_rather_than_reporting_empty(monkeypatch):
    """An auth failure must never look like "there are no runs".

    The deleted datastream_utils.check_if_s3_file_exists swallowed every ClientError and
    returned False, so a 403 reported the object simply did not exist. Harmless against a
    public bucket; with real credentials it is a routine failure mode, and an empty picker
    is the least actionable way to surface it.
    """
    storage = InMemoryStorage(fail_with=PermissionError("Access Denied"))
    monkeypatch.setenv(run_store.duckdb_conn.STORAGE_BACKEND_ENV, "s3")
    monkeypatch.setattr(run_store, "storage", lambda: storage)
    run_store.clear_caches()

    with pytest.raises(run_store.StorageUnreachable) as excinfo:
        run_store.list_runs()
    assert "Access Denied" in str(excinfo.value)


def test_a_single_unreadable_manifest_does_not_sink_the_listing(local_root):
    """One corrupt run is reported as unusable; the others still list."""
    with open(os.path.join(local_root, "alpha", manifest.MANIFEST_NAME), "w") as handle:
        handle.write("{not json")
    run_store.clear_caches()

    entries = {entry["name"]: entry for entry in run_store.list_runs()}
    assert entries["beta"]["usable"] is True
    assert entries["alpha"]["usable"] is False


# ---- Locations DuckDB can consume ------------------------------------------


def test_local_location_is_a_filesystem_path(local_root):
    location = run_store.location("alpha", "outputs", "ngen")
    assert location == os.path.join(local_root, "alpha", "outputs", "ngen")


def test_object_location_is_an_s3_uri(object_root):
    assert run_store.location("alpha", "outputs", "ngen") == (
        "s3://runs-bucket/alpha/outputs/ngen"
    )


def test_location_of_a_run_with_no_extra_parts(local_root):
    assert run_store.location("beta") == os.path.join(local_root, "beta")


# ---- Pagination ------------------------------------------------------------


def test_a_listing_spanning_several_pages_returns_every_entry(monkeypatch):
    """list_objects_v2 caps at 1000 keys per page, and a run is a prefix not a key.

    Modelled here by a storage holding more prefixes than any single page would carry, to
    pin that run_store never truncates a listing.
    """
    objects = {f"run-{index:05d}/{manifest.MANIFEST_NAME}": b"{}" for index in range(1500)}
    storage = InMemoryStorage(objects)
    monkeypatch.setenv(run_store.duckdb_conn.STORAGE_BACKEND_ENV, "s3")
    monkeypatch.setattr(run_store, "storage", lambda: storage)
    run_store.clear_caches()

    assert len(run_store.list_runs()) == 1500


# ---- Caching ---------------------------------------------------------------


def test_the_listing_is_cached_between_calls(local_root, mocker):
    """_get_list_model_runs is reached at least twice per data request in Unit 5.

    Uncached against an object store that is two round trips per request before the endpoint
    does any work of its own.
    """
    run_store.list_runs()
    spy = mocker.spy(run_store, "_read_manifest")
    for _ in range(5):
        run_store.list_runs()
    assert spy.call_count == 0


def test_clear_caches_makes_a_new_run_visible(local_root, mini_run_factory):
    assert len(run_store.list_runs()) == 2

    extra = mini_run_factory(name="src-gamma")
    manifest.write(extra, manifest.distill(extra, label="gamma"))
    os.rename(extra, os.path.join(local_root, "gamma"))

    run_store.clear_caches()
    assert len(run_store.list_runs()) == 3
