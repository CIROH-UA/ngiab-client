"""TEEHR names a location by its t-route flowpath; the map needs the nexus it drains to."""

import os

from tethysapp.ngiab import manifest
from tethysapp.ngiab import utils as ngiab_utils


def test_an_unknown_run_keeps_the_prefix_swap():
    assert ngiab_utils.teehr_nexus_id("no-such-run", "ngen-2863806") == "nex-2863806"


def test_the_nexus_comes_from_the_runs_crosswalk(mini_run_factory, mocker):
    import geopandas as gpd
    from shapely.geometry import Point

    run = mini_run_factory()
    gpd.GeoDataFrame(
        [{"id": "wb-100", "divide_id": "cat-100", "toid": "nex-102",
          "geometry": Point(1_500_000, 2_000_000)}],
        crs="EPSG:5070",
    ).to_file(os.path.join(run, "config", "mini.gpkg"), layer="flowpaths", driver="GPKG")
    manifest.write(run, manifest.distill(run))

    mocker.patch.object(
        ngiab_utils, "_run_entry",
        return_value={"path": run, "manifest": {"version_token": ""}},
    )
    assert ngiab_utils.teehr_nexus_id("mini", "ngen-100") == "nex-102"
