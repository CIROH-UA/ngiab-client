"""The registry seam: _get_list_model_runs backed by manifests instead of the database.

Read docs/plans/2026-08-22-001-feat-storage-backed-model-runs-plan.md, Unit 5.

**These tests deliberately do not stub `_get_list_model_runs`.** Everything else in the suite
does -- ``test_teehr_warehouse.py`` at six call sites, ``test_endpoint_parity.py`` throughout --
and that is correct for those tests, but it means they pin the *consumer* side and would pass
whatever the producer emitted. This file is the other half: it drives the real
manifest-backed producer against a real storage root and asserts the readers above it work
unchanged.

When this was written the table still existed and simply went unread, which is what made the
change revertible. Unit 8 has since dropped it, and the last test here now asserts that rather
than spying on a model that no longer exists.
"""

import json
import os

import pytest

from tethysapp.ngiab import manifest, run_store
from tethysapp.ngiab import utils as ngiab_utils

ALPHA_UUID = "11111111-1111-1111-1111-111111111111"
ALPHA_SECOND_UUID = "22222222-2222-2222-2222-222222222222"


@pytest.fixture
def registry_root(tmp_path, mini_run_factory, monkeypatch):
    """Two ingested runs under a real storage root, with no stubbing anywhere."""
    root = tmp_path / "ngiab_visualizer"
    root.mkdir()

    runs = {
        "alpha": ("2026-08-01T00:00:00+00:00", [ALPHA_UUID, ALPHA_SECOND_UUID]),
        "beta": ("2026-08-20T00:00:00+00:00", []),
    }
    for name, (created, legacy) in runs.items():
        source = mini_run_factory(name=f"src-{name}")
        document = manifest.distill(
            source, run_id=name, label=name, created=created, legacy_uuids=legacy
        )
        manifest.write(source, document)
        os.rename(source, root / name)

    monkeypatch.delenv(run_store.duckdb_conn.STORAGE_BACKEND_ENV, raising=False)
    monkeypatch.setenv(run_store.MANAGED_ROOT_ENV, str(root))
    monkeypatch.setenv(run_store.LISTING_TTL_ENV, "0")
    run_store.clear_caches()
    ngiab_utils._cached_catchment_variables.cache_clear()
    ngiab_utils._cached_value_matrix.cache_clear()
    return str(root)


def test_the_producer_emits_every_key_the_consumers_read(registry_root):
    """id, label, path, date, teehr_configuration_name -- the union of all four readers.

    _resolve_configuration_name reads teehr_configuration_name and path;
    get_model_runs_selectable reads id and label; scan_importable_runs reads path;
    _get_model_run_path_by_id reads id and path.
    """
    entries = ngiab_utils._get_list_model_runs()["model_runs"]
    assert len(entries) == 2
    for entry in entries:
        assert set(entry) >= {"id", "label", "path", "date", "teehr_configuration_name"}
        assert os.path.isdir(entry["path"])


def test_the_dead_fields_are_gone(registry_root):
    """Nothing ever wrote `tags`, and `subset` was readable only by as_dict."""
    entry = ngiab_utils._get_list_model_runs()["model_runs"][0]
    assert "subset" not in entry
    assert "tags" not in entry


def test_picker_order_is_newest_first(registry_root):
    """ModelRun.Meta.ordering was ["-created", "label"] and a listing is lexicographic."""
    assert [run["value"] for run in ngiab_utils.get_model_runs_selectable()] == ["beta", "alpha"]


def test_path_resolution_works_through_the_real_producer(registry_root):
    assert ngiab_utils._get_model_run_path_by_id("alpha").endswith("/alpha")
    assert ngiab_utils.model_run_exists("beta") is True
    assert ngiab_utils.model_run_exists("nope") is False
    assert ngiab_utils.model_run_exists(None) is False


def test_unknown_id_still_raises_unknown_model_run(registry_root):
    with pytest.raises(ngiab_utils.UnknownModelRun):
        ngiab_utils._require_run_entry("nope")


def test_a_legacy_uuid_resolves_to_its_run(registry_root):
    assert ngiab_utils._get_model_run_path_by_id(ALPHA_UUID).endswith("/alpha")


def test_every_legacy_uuid_on_one_directory_resolves(registry_root):
    """ModelRun.path was deliberately not unique, so a directory could carry several rows.

    A scalar legacy id would have resolved one of these and silently broken the other.
    """
    first = ngiab_utils._get_model_run_path_by_id(ALPHA_UUID)
    second = ngiab_utils._get_model_run_path_by_id(ALPHA_SECOND_UUID)
    assert first == second


def test_both_uuid_spellings_resolve(registry_root):
    """Django stored UUIDField as 32 undashed hex; a non-ORM writer could store 36 dashed."""
    undashed = ALPHA_UUID.replace("-", "")
    assert ngiab_utils._get_model_run_path_by_id(undashed) == (
        ngiab_utils._get_model_run_path_by_id(ALPHA_UUID)
    )


def test_a_directory_without_a_manifest_is_not_listed_but_is_not_lost(registry_root):
    """Preserves today's split: a directory the importer refused was never in the picker.

    It is still visible through run_store with a reason, which is what Unit 8's interface
    work needs -- hiding it outright is the failure describe_importable_run exists to avoid.
    """
    os.mkdir(os.path.join(registry_root, "not-a-run"))
    run_store.clear_caches()

    assert "not-a-run" not in [
        entry["id"] for entry in ngiab_utils._get_list_model_runs()["model_runs"]
    ]
    reported = {entry["name"]: entry for entry in run_store.list_runs()}
    assert reported["not-a-run"]["usable"] is False
    assert reported["not-a-run"]["reason"]


def test_a_corrupt_manifest_does_not_sink_the_whole_listing(registry_root):
    with open(os.path.join(registry_root, "alpha", manifest.MANIFEST_NAME), "w") as handle:
        handle.write("{not json")
    run_store.clear_caches()

    listed = [entry["id"] for entry in ngiab_utils._get_list_model_runs()["model_runs"]]
    assert listed == ["beta"]


def test_an_unknown_schema_version_is_not_silently_trusted(registry_root):
    """A future writer's manifest must not be read as if it were this schema.

    Recorded as a reason rather than an exception: one run written by a newer image should
    degrade to unusable, not take the portal's whole run list down with it.
    """
    path = os.path.join(registry_root, "alpha", manifest.MANIFEST_NAME)
    with open(path) as handle:
        document = json.load(handle)
    document["schema_version"] = manifest.SCHEMA_VERSION + 1
    with open(path, "w") as handle:
        json.dump(document, handle)
    run_store.clear_caches()

    reported = {entry["name"]: entry for entry in run_store.list_runs()}
    assert reported["alpha"]["usable"] is False
    assert "schema" in reported["alpha"]["reason"].lower()


def test_endpoints_read_a_run_through_the_manifest_backed_registry(registry_root):
    """The integration claim: a run resolved by directory name serves real data."""
    assert ngiab_utils.getCatchmentsList("alpha") == ["cat-100", "cat-101", "cat-102"]

    variables = ngiab_utils.get_catchment_variables("alpha")
    assert variables["time_column"] == "Time"
    assert variables["variables"] == ["RAIN_RATE", "Q_OUT", "SOIL_STORAGE"]

    frame = ngiab_utils._read_output_frame(
        ngiab_utils.run_outputs("alpha"), "cat-100", ["Time", "Q_OUT"], time_column="Time"
    )
    assert len(frame) == 6


def test_a_run_reached_by_its_legacy_uuid_serves_the_same_data(registry_root):
    """A shared link minted before the manifest must still render its run."""
    assert ngiab_utils.getCatchmentsList(ALPHA_UUID) == ngiab_utils.getCatchmentsList("alpha")


def test_a_new_run_appears_once_the_window_passes(registry_root, mini_run_factory, monkeypatch):
    """The staleness window is bounded, and clear_caches short-circuits it."""
    monkeypatch.setenv(run_store.LISTING_TTL_ENV, "600")
    run_store.clear_caches()
    assert len(ngiab_utils._get_list_model_runs()["model_runs"]) == 2

    extra = mini_run_factory(name="src-gamma")
    manifest.write(extra, manifest.distill(extra, run_id="gamma", label="gamma"))
    os.rename(extra, os.path.join(registry_root, "gamma"))

    assert len(ngiab_utils._get_list_model_runs()["model_runs"]) == 2

    run_store.clear_caches()
    assert len(ngiab_utils._get_list_model_runs()["model_runs"]) == 3


def test_the_default_window_is_ten_seconds(monkeypatch):
    """Stated rather than implied: the cost it bounds is small, the delay is felt."""
    monkeypatch.delenv(run_store.LISTING_TTL_ENV, raising=False)
    assert run_store.listing_ttl_seconds() == 10.0


def test_an_unparseable_ttl_falls_back_rather_than_crashing(monkeypatch):
    monkeypatch.setenv(run_store.LISTING_TTL_ENV, "soon")
    assert run_store.listing_ttl_seconds() == run_store.DEFAULT_LISTING_TTL_SECONDS


def test_the_registry_table_is_gone(db, registry_root):
    """Migration 0003 dropped it, and the listing never needed it.

    Asserted against the live schema rather than by spying on a model, because the model no
    longer exists to spy on -- which is the point.
    """
    from django.db import connection

    assert "ngiab_modelrun" not in connection.introspection.table_names()
    assert len(ngiab_utils._get_list_model_runs()["model_runs"]) == 2
