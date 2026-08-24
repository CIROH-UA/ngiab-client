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


def _converted_manifest():
    return {
        "output_dir": "outputs/ngen",
        "output_format": ".parquet",
        "output_groups": ["catchments-0.parquet"],
        "troute": {"format": ".parquet", "file": "outputs/troute/troute.parquet"},
    }


def _files():
    return {
        "manifest.json": "/x/manifest.json",
        "config/realization.json": "/x/config/realization.json",
        "config/mini.gpkg": "/x/config/mini.gpkg",
        "outputs/ngen/cat-100.csv": "/x/outputs/ngen/cat-100.csv",
        "outputs/ngen/cat-101.csv": "/x/outputs/ngen/cat-101.csv",
        "outputs/ngen/catchments-0.parquet": "/x/outputs/ngen/catchments-0.parquet",
        "outputs/troute/troute_output.nc": "/x/outputs/troute/troute_output.nc",
        "outputs/troute/troute.parquet": "/x/outputs/troute/troute.parquet",
        "forcings/forcing.nc": "/x/forcings/forcing.nc",
    }


def test_a_converted_run_publishes_parquet_not_the_csv_it_replaced():
    """One object per catchment CSV is what consolidating exists to avoid."""
    kept = set(ingest._publishable(_files(), _converted_manifest()))
    assert "outputs/ngen/catchments-0.parquet" in kept
    assert not [k for k in kept if k.endswith(".csv")]


def test_a_converted_run_drops_the_netcdf_troute_replaced():
    kept = set(ingest._publishable(_files(), _converted_manifest()))
    assert "outputs/troute/troute.parquet" in kept
    assert "outputs/troute/troute_output.nc" not in kept


def test_inputs_and_config_are_never_dropped():
    """Forcings and the GeoPackage have one copy; only outputs get replaced."""
    kept = set(ingest._publishable(_files(), _converted_manifest()))
    for required in ("config/realization.json", "config/mini.gpkg", "forcings/forcing.nc"):
        assert required in kept


def test_an_unconverted_run_keeps_every_source():
    """No parquet means the csv and the netCDF are the only copy there is."""
    document = {"output_dir": "outputs/ngen", "output_format": ".csv", "output_groups": [],
                "troute": {"format": ".nc", "file": "outputs/troute/troute_output.nc"}}
    assert set(ingest._publishable(_files(), document)) == set(_files())


def test_a_run_converted_only_halfway_keeps_the_unconverted_half():
    """Outputs consolidated, t-route not: the netCDF is still the only routing data."""
    document = {"output_dir": "outputs/ngen", "output_format": ".parquet",
                "output_groups": ["catchments-0.parquet"],
                "troute": {"format": ".nc", "file": "outputs/troute/troute_output.nc"}}
    kept = set(ingest._publishable(_files(), document))
    assert not [k for k in kept if k.endswith(".csv")]
    assert "outputs/troute/troute_output.nc" in kept


def test_a_missing_manifest_publishes_everything():
    """Never drop a source because the manifest could not be read."""
    assert set(ingest._publishable(_files(), {})) == set(_files())


def test_a_csv_outside_the_output_directory_is_kept():
    """Only the directory the manifest names was consolidated."""
    files = dict(_files(), **{"config/notes.csv": "/x/config/notes.csv"})
    assert "config/notes.csv" in ingest._publishable(files, _converted_manifest())
