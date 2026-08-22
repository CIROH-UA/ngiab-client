"""The run manifest: what ingest distills so the read path never probes the filesystem.

Read docs/plans/2026-08-22-001-feat-storage-backed-model-runs-plan.md, Unit 3.

Every assertion here is of the form "the distilled fact equals what the live probe returns
today". That is the only useful bar: the manifest is not a new source of truth, it is the same
truth moved somewhere an object store can serve. Where a test compares against
``gpkg_layer_bounds_4326`` or ``describe_troute_feature`` directly, that is deliberate --
those functions are the incumbent, and Unit 9 deletes them only once these agree.

The hot/sidecar split is load-bearing rather than tidiness. ``_get_list_model_runs()`` is
reached on essentially every request and reads *every* run's manifest, while the catchment
list and the flowpath crosswalk both scale with run size -- tens of thousands of entries is
normal. Embedding those would put megabytes of JSON parsing on the hot path, so they live in
sidecars that only the endpoints needing them load.
"""

import json
import os

import pytest

from tethysapp.ngiab import manifest
from tethysapp.ngiab import utils as ngiab_utils


@pytest.fixture
def distilled(mini_run):
    """A run and its distilled manifest, written to disk."""
    document = manifest.distill(mini_run, label="mini")
    manifest.write(mini_run, document)
    return mini_run, document


# ---- Distilled facts match the probes they replace -------------------------


def test_bounds_match_the_gpkg_probe(distilled):
    """R8: the extent gpkg_layer_bounds_4326 reads from the layer header."""
    run, document = distilled
    live = ngiab_utils.gpkg_layer_bounds_4326(ngiab_utils._find_gpkg_file_path(run))
    assert document["bounds"] == pytest.approx(live)


def test_crosswalk_matches_describe_troute_feature(distilled, monkeypatch):
    """R8: the flowpath-to-divide pairing, today read out of the gpkg as SQLite."""
    run, _ = distilled
    run_id = "44444444-4444-4444-4444-444444444444"
    monkeypatch.setattr(
        ngiab_utils,
        "_get_list_model_runs",
        lambda: {"model_runs": [{"id": run_id, "path": run, "label": "mini"}]},
    )
    ngiab_utils.describe_troute_feature.cache_clear()

    crosswalk = manifest.crosswalk(run)
    for feature_id in (100, 101, 102):
        live = ngiab_utils.describe_troute_feature(run_id, feature_id)
        assert crosswalk.get(f"wb-{feature_id}") == live[1]
        assert live[0] == f"wb-{feature_id}"


def test_catchment_list_matches_the_directory_listing(distilled):
    """R9: what _list_prefixed_output_files answers by listing the output directory."""
    run, _ = distilled
    live = ngiab_utils._list_prefixed_output_files(
        ngiab_utils.resolve_output_dir(run), "cat-"
    )
    assert manifest.catchments(run) == live


def test_catchment_list_is_identical_across_output_formats(mini_run_factory):
    """The reader prefers parquet; the distilled list must not depend on which is present."""
    csv_run = mini_run_factory(output_format="csv")
    parquet_run = mini_run_factory(output_format="parquet")
    assert manifest.distill(csv_run)["catchment_count"] == 3
    assert (
        manifest.distill(csv_run)["catchment_count"]
        == manifest.distill(parquet_run)["catchment_count"]
    )


def test_output_directory_matches_resolve_output_dir(distilled):
    """R9: what get_output_path reads out of realization.json on every request."""
    run, document = distilled
    live = ngiab_utils.resolve_output_dir(run)
    assert os.path.join(run, document["output_dir"]) == live


def test_output_format_is_recorded(mini_run_factory):
    """R9: _output_glob picks parquet over csv by globbing; the manifest states it instead."""
    assert manifest.distill(mini_run_factory(output_format="csv"))["output_format"] == ".csv"
    assert (
        manifest.distill(mini_run_factory(output_format="parquet"))["output_format"]
        == ".parquet"
    )
    assert manifest.distill(mini_run_factory(output_format="both"))["output_format"] == ".parquet"


def test_troute_variable_metadata_survives(distilled):
    """R7: parquet carries no netCDF attrs, and get_troute_vars builds its labels from them."""
    _, document = distilled
    variables = document["troute"]["variables"]
    assert variables["flow"] == {"long_name": "streamflow", "units": "m3 s-1"}
    assert variables["nudge"]["long_name"] == "streamflow nudge value"


# ---- Degrading, rather than raising ----------------------------------------


def test_run_without_a_gpkg_records_absence(mini_run_factory):
    """A run whose config holds no GeoPackage is a real case, not an error."""
    run = mini_run_factory()
    os.remove(os.path.join(run, "config", "mini.gpkg"))
    document = manifest.distill(run)
    assert document["gpkg"] is None
    assert document["bounds"] is None
    assert document["crosswalk_count"] == 0


def test_missing_realization_falls_back_like_resolve_output_dir(mini_run_factory):
    document = manifest.distill(mini_run_factory(realization=False))
    assert document["output_dir"] == os.path.join("outputs", "ngen")


def test_malformed_realization_is_defaulted_not_fatal(mini_run_factory, caplog):
    run = mini_run_factory()
    with open(os.path.join(run, "config", "realization.json"), "w") as handle:
        handle.write("{not json")
    document = manifest.distill(run)
    assert document["output_dir"] == os.path.join("outputs", "ngen")


def test_run_without_troute_records_absence(mini_run_factory):
    run = mini_run_factory()
    troute_dir = os.path.join(run, "outputs", "troute")
    for name in os.listdir(troute_dir):
        os.remove(os.path.join(troute_dir, name))
    document = manifest.distill(run)
    assert document["troute"] is None


def test_unconventional_flowpath_ids_are_carried_verbatim(mini_run_factory):
    """The wb-/cat- numbering is a convention of the fabric, not a guarantee.

    describe_troute_feature's docstring says exactly this, which is why it reads the pairing
    out of the gpkg rather than assuming it. The manifest must not re-introduce the
    assumption by deriving one id from the other.
    """
    import geopandas as gpd
    from shapely.geometry import Point

    run = mini_run_factory()
    gpkg = os.path.join(run, "config", "mini.gpkg")
    gpd.GeoDataFrame(
        [{"id": "link-7", "divide_id": "cat-100", "geometry": Point(1_500_000, 2_000_000)}],
        crs="EPSG:5070",
    ).to_file(gpkg, layer="flowpaths", driver="GPKG")

    manifest.write(run, manifest.distill(run))
    assert manifest.crosswalk(run) == {"link-7": "cat-100"}


# ---- TEEHR presence and configuration --------------------------------------


def test_teehr_absence_is_recorded(distilled):
    """R15: evaluation_dir's os.path.isdir returns False for an s3:// path regardless."""
    _, document = distilled
    assert document["teehr"]["present"] is False


def test_teehr_configuration_name_read_from_the_producer_manifest(mini_run_factory):
    """The key is teehr_configuration_name; reading configuration_name returned empty."""
    run = mini_run_factory()
    with open(os.path.join(run, "teehr_run_manifest.json"), "w") as handle:
        json.dump({"teehr_configuration_name": "ngen_mini"}, handle)
    assert manifest.distill(run)["teehr"]["configuration_name"] == "ngen_mini"


# ---- Identity: R14 ---------------------------------------------------------


def test_legacy_uuids_is_a_list(mini_run):
    """ModelRun.path is deliberately not unique, so one directory can carry several ids.

    The model's own comment: "the same directory is legitimately registered more than once
    today, once per import, and de-duplicating would silently drop rows on migration." A
    scalar field here would break every share link but one.
    """
    document = manifest.distill(
        mini_run,
        legacy_uuids=["11111111-1111-1111-1111-111111111111", "22222222222222222222222222222222"],
    )
    assert isinstance(document["legacy_uuids"], list)
    assert len(document["legacy_uuids"]) == 2


def test_both_uuid_forms_normalise_to_the_same_value():
    """Django stores UUIDField in SQLite as 32 undashed hex and builds lookups that way.

    migrations/0002_normalize_model_run_ids exists because a row holding the 36-character
    dashed form reads back fine, shows up in the picker, and can never be matched by
    filter(id=...). Resolving by manifest must not reimport that.
    """
    dashed = "11111111-1111-1111-1111-111111111111"
    undashed = "11111111111111111111111111111111"
    assert manifest.normalize_uuid(dashed) == manifest.normalize_uuid(undashed)


def test_legacy_uuids_are_stored_normalised(mini_run):
    document = manifest.distill(
        mini_run, legacy_uuids=["11111111-1111-1111-1111-111111111111"]
    )
    assert document["legacy_uuids"] == ["11111111111111111111111111111111"]


def test_created_is_captured(mini_run):
    """Meta.ordering was ["-created", "label"]; a directory listing is lexicographic.

    Without a recorded timestamp the picker reorders and a different run loads by default on
    every fresh visit, which no parity test on payload *shape* would catch.
    """
    document = manifest.distill(mini_run, created="2026-08-22T10:00:00+00:00")
    assert document["created"] == "2026-08-22T10:00:00+00:00"


# ---- Version token ---------------------------------------------------------


def test_version_token_is_stable_for_unchanged_content(mini_run):
    """Unit 7's backfill must be idempotent, so the token cannot be random."""
    first = manifest.distill(mini_run, created="2026-08-22T10:00:00+00:00")
    second = manifest.distill(mini_run, created="2026-08-22T10:00:00+00:00")
    assert first["version_token"] == second["version_token"]


def test_version_token_changes_when_outputs_change(mini_run):
    """It replaces os.stat's mtime as the cache key, which returns None on an S3 prefix.

    If the key never changes, a re-ingested run serves stale bins forever.
    """
    before = manifest.distill(mini_run)["version_token"]
    output_dir = os.path.join(mini_run, "outputs", "ngen")
    with open(os.path.join(output_dir, "cat-100.csv"), "a") as handle:
        handle.write("6,2017-01-01 06:00:00,9.9,9.9,9.9\n")
    assert manifest.distill(mini_run)["version_token"] != before


def test_version_token_changes_when_a_catchment_is_added(mini_run):
    before = manifest.distill(mini_run)["version_token"]
    output_dir = os.path.join(mini_run, "outputs", "ngen")
    with open(os.path.join(output_dir, "cat-999.csv"), "w") as handle:
        handle.write("Time Step,Time,RAIN_RATE\n0,2017-01-01 00:00:00,0.0\n")
    assert manifest.distill(mini_run)["version_token"] != before


# ---- Hot manifest stays small ----------------------------------------------


def test_hot_manifest_does_not_embed_the_bulk(distilled):
    """The listing reads every run's manifest on nearly every request.

    Embedding the catchment list and crosswalk would put megabytes of JSON parsing on that
    path for a large run. Counts live in the hot document; the entries do not.
    """
    run, _ = distilled
    with open(os.path.join(run, manifest.MANIFEST_NAME)) as handle:
        raw = json.load(handle)

    assert raw["catchment_count"] == 3
    assert raw["crosswalk_count"] == 3
    assert "catchments" not in raw
    assert "crosswalk" not in raw


def test_sidecars_are_written_and_readable(distilled):
    run, _ = distilled
    assert manifest.catchments(run) == ["cat-100", "cat-101", "cat-102"]
    assert manifest.crosswalk(run) == {
        "wb-100": "cat-100",
        "wb-101": "cat-101",
        "wb-102": "cat-102",
    }


def test_read_returns_the_hot_document(distilled):
    run, document = distilled
    assert manifest.read(run)["version_token"] == document["version_token"]
    assert manifest.read(run)["schema_version"] == manifest.SCHEMA_VERSION


def test_writing_twice_is_idempotent(mini_run):
    """Unit 7 runs the backfill on every start; re-running must change nothing on disk."""
    manifest.write(mini_run, manifest.distill(mini_run, created="2026-08-22T10:00:00+00:00"))
    with open(os.path.join(mini_run, manifest.MANIFEST_NAME)) as handle:
        first = handle.read()

    manifest.write(mini_run, manifest.distill(mini_run, created="2026-08-22T10:00:00+00:00"))
    with open(os.path.join(mini_run, manifest.MANIFEST_NAME)) as handle:
        second = handle.read()

    assert first == second


# ---- Integration: the manifest answers what the probes answer --------------


def test_manifest_alone_answers_every_probe(distilled):
    """The claim Unit 9 depends on, stated as one assertion.

    If this passes, no read-path request needs to stat, walk, list, or open a GeoPackage --
    which is what makes the hosted read path parquet-only.
    """
    run, document = distilled

    assert document["output_dir"] and document["output_format"]
    assert document["bounds"] is not None
    assert document["version_token"]
    assert document["teehr"]["present"] is False
    assert manifest.catchments(run)
    assert manifest.crosswalk(run)
    assert document["troute"]["variables"]


# ---- Sidecar caching -------------------------------------------------------


def test_crosswalk_is_cached_between_calls(distilled, mocker):
    """80 ms for a 10,000-flowpath run, measured. Per feature click that is unusable.

    describe_troute_feature is keyed per feature behind an lru_cache of 32, so Unit 9 must
    load the crosswalk whole and keep it, not read it once per lookup.
    """
    run, _ = distilled
    from tethysapp.ngiab import duckdb_conn

    manifest.clear_caches()
    manifest.crosswalk(run)
    spy = mocker.spy(duckdb_conn, "query")
    for _ in range(5):
        manifest.crosswalk(run)
    assert spy.call_count == 0


def test_changing_the_gpkg_invalidates_the_crosswalk_cache(mini_run_factory):
    """The version token has to cover every distilled input, not just the outputs.

    Derived from the output directory alone, a gpkg edit would leave the token unchanged and
    the cached crosswalk stale -- serving the previous fabric's pairings indefinitely.
    """
    import geopandas as gpd
    from shapely.geometry import Point

    run = mini_run_factory()
    manifest.write(run, manifest.distill(run))
    assert manifest.crosswalk(run)["wb-100"] == "cat-100"

    gpkg = os.path.join(run, "config", "mini.gpkg")
    gpd.GeoDataFrame(
        [{"id": "wb-100", "divide_id": "cat-999", "geometry": Point(1_500_000, 2_000_000)}],
        crs="EPSG:5070",
    ).to_file(gpkg, layer="flowpaths", driver="GPKG")

    manifest.write(run, manifest.distill(run))
    assert manifest.crosswalk(run)["wb-100"] == "cat-999"


def test_catchments_are_cached_on_the_version_token(distilled):
    run, _ = distilled
    manifest.clear_caches()
    assert manifest.catchments(run) == ["cat-100", "cat-101", "cat-102"]

    output_dir = os.path.join(run, "outputs", "ngen")
    with open(os.path.join(output_dir, "cat-777.csv"), "w") as handle:
        handle.write("Time Step,Time,RAIN_RATE\n0,2017-01-01 00:00:00,0.0\n")
    manifest.write(run, manifest.distill(run))
    assert "cat-777" in manifest.catchments(run)
