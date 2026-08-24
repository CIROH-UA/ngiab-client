"""The run manifest: what ingest distills so the read path never probes the filesystem.
Hot listing fields and per-run sidecars are split so the hot path stays cheap."""

import json
import os

import pytest

from tethysapp.ngiab import manifest


@pytest.fixture
def distilled(mini_run):
    """A run and its distilled manifest, written to disk."""
    document = manifest.distill(mini_run, label="mini")
    manifest.write(mini_run, document)
    return mini_run, document


def test_bounds_are_reprojected_to_4326(distilled):
    """The map's extent, read from the layer header at ingest, is reprojected to EPSG:4326."""
    _, document = distilled
    west, south, east, north = document["bounds"]
    assert -130 < west < east < -60
    assert 20 < south < north < 55


def test_crosswalk_pairs_every_flowpath_with_its_divide(distilled):
    """R8: the pairing describe_troute_feature used to read out of the gpkg as SQLite."""
    run, _ = distilled
    crosswalk = manifest.crosswalk(run)
    assert crosswalk == {
        "wb-100": "cat-100",
        "wb-101": "cat-101",
        "wb-102": "cat-102",
    }


def test_catchment_list_is_what_the_run_wrote(distilled):
    """R9: what _list_prefixed_output_files answered by listing the output directory."""
    run, _ = distilled
    assert manifest.catchments(run) == ["cat-100", "cat-101", "cat-102"]


def test_catchment_list_is_identical_across_output_formats(mini_run_factory):
    """The reader prefers parquet; the distilled list must not depend on which is present."""
    csv_run = mini_run_factory(output_format="csv")
    parquet_run = mini_run_factory(output_format="parquet")
    assert manifest.distill(csv_run)["catchment_count"] == 3
    assert (
        manifest.distill(csv_run)["catchment_count"]
        == manifest.distill(parquet_run)["catchment_count"]
    )


def test_output_directory_is_recorded(distilled):
    """R9: what get_output_path read out of realization.json on every request."""
    _, document = distilled
    assert document["output_dir"] == os.path.join("outputs", "ngen")


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
    """The wb-/cat- numbering is a convention of the fabric, not a guarantee the manifest assumes."""
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


def test_legacy_uuids_is_a_list(mini_run):
    """ModelRun.path is deliberately not unique, so one directory can carry several legacy ids."""
    document = manifest.distill(
        mini_run,
        legacy_uuids=["11111111-1111-1111-1111-111111111111", "22222222222222222222222222222222"],
    )
    assert isinstance(document["legacy_uuids"], list)
    assert len(document["legacy_uuids"]) == 2


def test_both_uuid_forms_normalise_to_the_same_value():
    """Both the dashed and undashed uuid spellings must resolve to the same manifest."""
    dashed = "11111111-1111-1111-1111-111111111111"
    undashed = "11111111111111111111111111111111"
    assert manifest.normalize_uuid(dashed) == manifest.normalize_uuid(undashed)


def test_legacy_uuids_are_stored_normalised(mini_run):
    document = manifest.distill(
        mini_run, legacy_uuids=["11111111-1111-1111-1111-111111111111"]
    )
    assert document["legacy_uuids"] == ["11111111111111111111111111111111"]


def test_created_is_captured(mini_run):
    """The creation timestamp is captured, since a directory listing alone is only lexicographic."""
    document = manifest.distill(mini_run, created="2026-08-22T10:00:00+00:00")
    assert document["created"] == "2026-08-22T10:00:00+00:00"


def test_version_token_is_stable_for_unchanged_content(mini_run):
    """Unit 7's backfill must be idempotent, so the token cannot be random."""
    first = manifest.distill(mini_run, created="2026-08-22T10:00:00+00:00")
    second = manifest.distill(mini_run, created="2026-08-22T10:00:00+00:00")
    assert first["version_token"] == second["version_token"]


def test_version_token_changes_when_outputs_change(mini_run):
    """The version token must change when a run's outputs change, or stale bins serve forever."""
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


def test_hot_manifest_does_not_embed_the_bulk(distilled):
    """The hot manifest carries counts only; the catchment list and crosswalk live in sidecars."""
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


def test_manifest_alone_answers_every_probe(distilled):
    """The manifest alone answers every probe the read path used to make against the filesystem."""
    run, document = distilled

    assert document["output_dir"] and document["output_format"]
    assert document["bounds"] is not None
    assert document["version_token"]
    assert document["teehr"]["present"] is False
    assert manifest.catchments(run)
    assert manifest.crosswalk(run)
    assert document["troute"]["variables"]


def test_crosswalk_is_cached_between_calls(distilled, mocker):
    """The flowpath crosswalk is loaded once and kept, not re-read on every feature lookup."""
    run, _ = distilled
    from tethysapp.ngiab import duckdb_conn

    manifest.clear_caches()
    manifest.crosswalk(run)
    spy = mocker.spy(duckdb_conn, "query")
    for _ in range(5):
        manifest.crosswalk(run)
    assert spy.call_count == 0


def test_changing_the_gpkg_invalidates_the_crosswalk_cache(mini_run_factory):
    """The version token must cover the GeoPackage too, or an edited fabric serves a stale crosswalk."""
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
