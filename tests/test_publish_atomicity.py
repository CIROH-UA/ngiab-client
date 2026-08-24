"""A run appears in the picker whole, or it does not appear.
A rename on a filesystem, and manifest-last ordering in a bucket, give that single visible moment."""

import tarfile
from types import SimpleNamespace

import pytest

from tethysapp.ngiab import archive, ingest, manifest, run_store


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
def archived(mini_run_factory, tmp_path):
    def _archived(name="uploaded", **kwargs):
        run = mini_run_factory(name, **kwargs)
        path = tmp_path / f"{name}.tar.gz"
        with tarfile.open(path, "w:gz") as handle:
            handle.add(run, arcname=name)
        return str(path)
    return _archived


def test_the_workspace_lives_under_the_storage_root(storage_root):
    """Publishing must be a rename, not a cross-device copy, so the scratch space shares its filesystem."""
    workspace = ingest._workspace()
    try:
        assert str(workspace).startswith(str(storage_root))
        assert run_store.STAGING_DIR in workspace
    finally:
        import shutil
        shutil.rmtree(workspace, ignore_errors=True)


def test_the_workspace_is_not_listed_as_a_run(storage_root):
    workspace = ingest._workspace()
    try:
        run_store.clear_caches()
        assert run_store.list_runs() == []
    finally:
        import shutil
        shutil.rmtree(workspace, ignore_errors=True)


def test_publishing_onto_an_existing_run_is_refused(storage_root, archived):
    """The rename, not the pre-flight existence check, is what must refuse a colliding name."""
    (storage_root / "taken").mkdir()
    (storage_root / "taken" / "sentinel").write_text("original")

    source = storage_root / run_store.STAGING_DIR / "candidate"
    source.mkdir(parents=True)
    (source / "other").write_text("new")

    with pytest.raises(archive.ArchiveRejected, match="appeared while"):
        ingest._publish_directory(str(source), "taken")

    assert (storage_root / "taken" / "sentinel").read_text() == "original"


def test_a_published_run_is_complete_the_moment_it_appears(storage_root, archived):
    ingest.publish(archived(), "gage-99")
    run = storage_root / "gage-99"
    assert (run / "manifest.json").is_file()
    assert (run / "outputs" / "ngen").is_dir()
    assert [e["name"] for e in run_store.list_runs()] == ["gage-99"]


def test_nothing_is_left_in_staging_after_a_publish(storage_root, archived):
    ingest.publish(archived(), "gage-99")
    staging = storage_root / run_store.STAGING_DIR
    leftovers = [p for p in staging.iterdir() if p.name.startswith("ingest-")] \
        if staging.exists() else []
    assert leftovers == []


class _Recorder:
    """A storage that records the order keys are written, and can fail on cue."""

    def __init__(self, fail_on=None, client=None, bucket_name=None):
        self.saved = []
        self.deleted = []
        self.fail_on = fail_on
        self.bucket_name = bucket_name
        self.location = ""
        if client is not None:
            self.connection = SimpleNamespace(meta=SimpleNamespace(client=client))

    def save(self, key, content):
        if self.fail_on and self.fail_on in key:
            raise OSError("the bucket said no")
        self.saved.append(key)
        return key

    def exists(self, key):
        return key in self.saved

    def listdir(self, prefix):
        head = f"{prefix}/" if prefix else ""
        directories, files = set(), []
        for key in self.saved:
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


@pytest.fixture
def hosted(monkeypatch):
    from tethysapp.ngiab import duckdb_conn

    monkeypatch.setenv(duckdb_conn.STORAGE_BACKEND_ENV, "s3")
    yield
    run_store.clear_caches()


def _prepared(tmp_path):
    run = tmp_path / "prepared"
    (run / "outputs" / "ngen").mkdir(parents=True)
    (run / "outputs" / "ngen" / "catchments-0.parquet").write_bytes(b"x")
    (run / "config").mkdir()
    (run / "config" / "realization.json").write_text("{}")
    (run / manifest.MANIFEST_NAME).write_text("{}")
    return str(run)


def test_the_manifest_is_uploaded_last(hosted, tmp_path, monkeypatch):
    """The manifest goes up last, so a crash partway never leaves a prefix the picker offers."""
    recorder = _Recorder()
    monkeypatch.setattr(run_store, "storage", lambda: recorder)

    ingest._publish_directory(_prepared(tmp_path), "gage-99")

    assert recorder.saved[-1].endswith(manifest.MANIFEST_NAME)
    assert len(recorder.saved) > 1


def test_a_failed_upload_removes_what_it_wrote(hosted, tmp_path, monkeypatch):
    """Otherwise a half-uploaded prefix sits in the bucket holding the name."""
    recorder = _Recorder(fail_on="realization.json")
    monkeypatch.setattr(run_store, "storage", lambda: recorder)

    with pytest.raises(OSError):
        ingest._publish_directory(_prepared(tmp_path), "gage-99")

    assert recorder.deleted, "the partial run should have been cleaned up"
    assert not any(k.endswith(manifest.MANIFEST_NAME) for k in recorder.saved)
