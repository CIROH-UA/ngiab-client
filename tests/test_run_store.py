"""Listing runs from a storage root, local or object store.
Most tests run twice, against a real FileSystemStorage and an in-memory S3 stand-in."""

import io
import os

import pytest
from django.core.files.storage import Storage

from tethysapp.ngiab import manifest, run_store


class InMemoryStorage(Storage):
    """The smallest thing that behaves like an object store for run_store's purposes."""

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


def test_local_root_follows_the_persist_directory(monkeypatch):
    """The runs root sits under TETHYS_PERSIST, so moving one moves the other.

    It was hardcoded to the pre-uvx /var/lib/tethys_persist, which is not a directory in the
    tethys-uvx base at all -- and when the Apptainer runscript moved TETHYS_PERSIST onto the
    host, the runs root silently stayed behind on a read-only path.
    """
    monkeypatch.delenv(run_store.MANAGED_ROOT_ENV, raising=False)
    monkeypatch.setenv(run_store.PERSIST_ENV, "/somewhere/persist")
    assert run_store.local_root() == "/somewhere/persist/ngiab_visualizer"


def test_local_root_falls_back_to_the_base_image_persist(monkeypatch):
    """With no TETHYS_PERSIST at all, the tethys-uvx default is the sensible guess."""
    monkeypatch.delenv(run_store.MANAGED_ROOT_ENV, raising=False)
    monkeypatch.delenv(run_store.PERSIST_ENV, raising=False)
    assert run_store.local_root() == "/home/tethys/persist/ngiab_visualizer"


def test_local_root_is_overridable(monkeypatch):
    """An explicit root wins over the derivation, so a bound directory can be read in place."""
    monkeypatch.setenv(run_store.PERSIST_ENV, "/somewhere/persist")
    monkeypatch.setenv(run_store.MANAGED_ROOT_ENV, "/somewhere/else")
    assert run_store.local_root() == "/somewhere/else"


def test_local_listing_returns_one_entry_per_run(local_root):
    names = [entry["name"] for entry in run_store.list_runs()]
    assert sorted(names) == ["alpha", "beta"]


def test_object_listing_returns_the_same_entries(object_root):
    names = [entry["name"] for entry in run_store.list_runs()]
    assert sorted(names) == ["alpha", "beta"]


def test_both_backends_order_newest_first(local_root):
    """Both backends order runs newest first, matching the old lexicographic listing."""
    assert [entry["name"] for entry in run_store.list_runs()] == ["beta", "alpha"]


def test_object_backend_orders_newest_first(object_root):
    assert [entry["name"] for entry in run_store.list_runs()] == ["beta", "alpha"]


def test_entries_carry_the_hot_manifest(local_root):
    entry = run_store.list_runs()[0]
    assert entry["manifest"]["label"] == "beta"
    assert entry["manifest"]["catchment_count"] == 3
    assert entry["usable"] is True
    assert entry["reason"] is None


def test_empty_root_returns_an_empty_list(tmp_path, monkeypatch):
    monkeypatch.delenv(run_store.duckdb_conn.STORAGE_BACKEND_ENV, raising=False)
    monkeypatch.setenv(run_store.MANAGED_ROOT_ENV, str(tmp_path / "nothing-here"))
    run_store.clear_caches()
    assert run_store.list_runs() == []


def test_directory_without_a_manifest_is_reported_not_hidden(local_root):
    """A directory without a manifest is reported, not hidden from the listing."""
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


def test_unreachable_backend_raises_rather_than_reporting_empty(monkeypatch):
    """An unreachable backend raises rather than reporting that there are no runs."""
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


def test_local_location_is_a_filesystem_path(local_root):
    location = run_store.location("alpha", "outputs", "ngen")
    assert location == os.path.join(local_root, "alpha", "outputs", "ngen")


def test_object_location_is_an_s3_uri(object_root):
    assert run_store.location("alpha", "outputs", "ngen") == (
        "s3://runs-bucket/alpha/outputs/ngen"
    )


def test_location_of_a_run_with_no_extra_parts(local_root):
    assert run_store.location("beta") == os.path.join(local_root, "beta")


def test_a_listing_spanning_several_pages_returns_every_entry(monkeypatch):
    """A listing spanning several pages of list_objects_v2 still returns every entry."""
    objects = {f"run-{index:05d}/{manifest.MANIFEST_NAME}": b"{}" for index in range(1500)}
    storage = InMemoryStorage(objects)
    monkeypatch.setenv(run_store.duckdb_conn.STORAGE_BACKEND_ENV, "s3")
    monkeypatch.setattr(run_store, "storage", lambda: storage)
    run_store.clear_caches()

    assert len(run_store.list_runs()) == 1500


def test_the_listing_is_cached_between_calls(local_root, mocker):
    """The run listing is cached between calls, not fetched fresh from the backend each time."""
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


def test_the_launcher_mounts_where_the_app_looks():
    """The launcher's mount target and the app's runs root are one contract, in two files.

    Deriving local_root() from TETHYS_PERSIST removed one hardcoded path but left the
    launcher holding its own copy. When they disagree the volume still mounts, nothing
    errors, and the picker is simply empty -- so the two literals are compared here.
    """
    import re

    root = os.path.dirname(os.path.dirname(os.path.abspath(run_store.__file__)))
    launcher = os.path.join(os.path.dirname(root), "viewOnTethys.sh")
    if not os.path.isfile(launcher):
        pytest.skip("viewOnTethys.sh is not in this build context")

    with open(launcher) as handle:
        text = handle.read()

    declared = re.search(r'^TETHYS_PERSIST_PATH="([^"]+)"', text, re.M)
    assert declared, "viewOnTethys.sh no longer declares TETHYS_PERSIST_PATH"
    assert declared.group(1) == run_store.DEFAULT_PERSIST

    mount = re.search(r'-v "\$MODELS_RUNS_DIRECTORY:\$TETHYS_PERSIST_PATH/(\w+)', text)
    assert mount, "the launcher no longer mounts the runs directory the way this test reads"
    assert mount.group(1) == run_store.MANAGED_DIR_NAME
