"""Fixtures for the endpoint-parity suite.

The mini run is *generated*, not committed. A real NGIAB run is gigabytes, so the only
committable alternative is a hand-trimmed binary GeoPackage and a scattering of csv, which
nobody can review in a diff and which goes stale silently. A generator is reviewable code,
and it fails loudly: if it cannot build a run, every test that needs one errors rather than
skipping. That distinction is the whole point of this file -- the existing suite in
test_teehr_warehouse.py skips 19 of its 28 tests when its fixture warehouse is absent, which
is indistinguishable from passing.

Nothing here reads the app. The fixtures write what ngen, t-route and the hydrofabric write,
so a test can assert that the readers interpret real-shaped input correctly rather than
asserting that the readers agree with themselves.

Run these inside the image (`docker build --target test`), not against a local conda
environment: the base image installs tethys-platform from git main, so a locally built
environment is a different Tethys than the one that ships.
"""

import json
import os

import numpy as np
import pandas as pd
import pytest

# The positional contract every catchment reader depends on: column 0 is the step, column 1
# is the timestamp, and everything after is a plottable variable. See
# tethysapp/ngiab/utils.py get_catchment_variables.
STEP_COLUMN = "Time Step"
TIME_COLUMN = "Time"

# A projected CRS, as real hydrofabric GeoPackages use, so gpkg_layer_bounds_4326's
# transform_bounds path is exercised rather than trivially skipped.
FABRIC_CRS = "EPSG:5070"

DEFAULT_VARIABLES = ("RAIN_RATE", "Q_OUT", "SOIL_STORAGE")


def _timestamps(count, start="2017-01-01 00:00:00", freq="h"):
    return pd.date_range(start=start, periods=count, freq=freq)


def _catchment_frame(index, times, variables):
    """One catchment's output, with values that differ per catchment and per variable.

    Deterministic rather than random: a parity baseline that changes between runs is not a
    baseline. The arithmetic only has to produce a spread wide enough that quantile class
    breaks do not collapse into a single class.
    """
    frame = pd.DataFrame(
        {
            STEP_COLUMN: np.arange(len(times), dtype="int64"),
            TIME_COLUMN: times.strftime("%Y-%m-%d %H:%M:%S"),
        }
    )
    for offset, name in enumerate(variables):
        base = np.linspace(0.0, 1.0 + index, num=len(times))
        frame[name] = np.round(base * (offset + 1) + index * 0.5, 6)
    return frame


def _csv_to_parquet(src, dst):
    """Convert with DuckDB, the way the shipped converter does.

    Not pandas.to_parquet: pyarrow is deliberately absent from the image, which the converter
    at tethysapp/ngiab/management/commands/convert_outputs.py records as the reason it uses
    DuckDB. Producing the fixture the same way means the parquet under test has the same
    types and compression as a real converted run, rather than whatever a different writer
    would have chosen.
    """
    import duckdb

    escaped_src = src.replace("'", "''")
    escaped_dst = dst.replace("'", "''")
    duckdb.execute(
        f"COPY (SELECT * FROM read_csv_auto('{escaped_src}')) "
        f"TO '{escaped_dst}' (FORMAT PARQUET, COMPRESSION ZSTD)"
    )


def _write_gpkg(path, catchment_ids):
    """A hydrofabric-shaped GeoPackage: divides, nexus, and the flowpaths crosswalk.

    Three layers because three different readers want three different things -- extent from
    divides or nexus (pyogrio.read_info), and the flowpath-to-divide pairing from flowpaths
    read as plain SQLite. Written with geopandas so the file is a genuine GeoPackage rather
    than a SQLite database that merely resembles one.
    """
    import geopandas as gpd
    from shapely.geometry import Point, Polygon

    divides, nexus, flowpaths = [], [], []
    for index, catchment_id in enumerate(catchment_ids):
        numeric = catchment_id.split("-")[1]
        x0, y0 = 1_500_000.0 + index * 1000.0, 2_000_000.0 + index * 1000.0
        divides.append(
            {
                "divide_id": catchment_id,
                "geometry": Polygon(
                    [(x0, y0), (x0 + 900, y0), (x0 + 900, y0 + 900), (x0, y0 + 900)]
                ),
            }
        )
        nexus.append({"id": f"nex-{numeric}", "geometry": Point(x0 + 450, y0 + 450)})
        flowpaths.append(
            {
                "id": f"wb-{numeric}",
                "divide_id": catchment_id,
                "geometry": Point(x0 + 100, y0 + 100),
            }
        )

    for layer, records in (("divides", divides), ("nexus", nexus), ("flowpaths", flowpaths)):
        gpd.GeoDataFrame(records, crs=FABRIC_CRS).to_file(path, layer=layer, driver="GPKG")


def _write_troute_netcdf(path, feature_ids, times):
    """T-route's NetCDF shape: a (feature_id, time) frame carrying CF metadata.

    The metadata is not decoration. get_troute_vars builds its picker labels from long_name
    and units, and to_dataframe() on this produces the MultiIndex that getTrouteTimeSeries
    slices with df.xs(..., level="feature_id"). Both are contracts a parquet conversion has
    to answer for.
    """
    import xarray as xr

    shape = (len(feature_ids), len(times))
    flow = np.round(np.linspace(0.1, 9.9, num=shape[0] * shape[1]).reshape(shape), 6)
    dataset = xr.Dataset(
        {
            "flow": (("feature_id", "time"), flow),
            "depth": (("feature_id", "time"), np.round(flow * 0.1, 6)),
            "nudge": (("feature_id", "time"), np.zeros(shape)),
        },
        coords={"feature_id": np.array(feature_ids, dtype="int64"), "time": times},
    )
    dataset["flow"].attrs = {"long_name": "streamflow", "units": "m3 s-1"}
    dataset["depth"].attrs = {"long_name": "depth", "units": "m"}
    dataset["nudge"].attrs = {"long_name": "streamflow nudge value", "units": "m3 s-1"}
    dataset.to_netcdf(path)


def _write_troute_csv(path, feature_ids, times):
    """T-route's flat csv shape, which the reader reaches by a different branch.

    get_troute_df prefers csv over NetCDF, and getTrouteTimeSeries falls back to a featureID
    column when the frame has no MultiIndex. Capitalisation differs from the NetCDF path's
    feature_id on purpose: that mismatch is real, and a converter that unifies the two has to
    decide which one wins.
    """
    rows = []
    for index, feature_id in enumerate(feature_ids):
        for step, moment in enumerate(times):
            rows.append(
                {
                    "featureID": feature_id,
                    "current_time": moment.strftime("%Y-%m-%d %H:%M:%S"),
                    "flow": round(0.1 + index + step * 0.01, 6),
                    "depth": round(0.01 + index * 0.1, 6),
                }
            )
    pd.DataFrame(rows).to_csv(path, index=False)


def build_mini_run(
    root,
    *,
    output_format="csv",
    catchment_count=3,
    variables=DEFAULT_VARIABLES,
    timesteps=6,
    narrow_last=False,
    troute="nc",
    realization=True,
):
    """Write one NGIAB-shaped run directory and return its path.

    ``narrow_last`` gives the final catchment a shorter variable list, reproducing the
    heterogeneous-formulation case that ``_output_glob``'s ``union_by_name=true`` exists to
    handle. Consolidating per-catchment files threatens exactly this, so the parity baseline
    has to contain one.

    ``output_format`` writes csv, parquet, or ``"both"``. The reader prefers parquet when
    both are present, and the two must produce identical responses.
    """
    root = str(root)
    config_dir = os.path.join(root, "config")
    ngen_dir = os.path.join(root, "outputs", "ngen")
    troute_dir = os.path.join(root, "outputs", "troute")
    for directory in (config_dir, ngen_dir, troute_dir):
        os.makedirs(directory, exist_ok=True)

    catchment_ids = [f"cat-{100 + index}" for index in range(catchment_count)]
    times = _timestamps(timesteps)

    for index, catchment_id in enumerate(catchment_ids):
        columns = variables
        if narrow_last and index == len(catchment_ids) - 1:
            columns = variables[:1]
        frame = _catchment_frame(index, times, columns)
        stem = os.path.join(ngen_dir, catchment_id)
        frame.to_csv(f"{stem}.csv", index=False)
        if output_format in ("parquet", "both"):
            _csv_to_parquet(f"{stem}.csv", f"{stem}.parquet")
        if output_format == "parquet":
            os.remove(f"{stem}.csv")

    _write_gpkg(os.path.join(config_dir, "mini.gpkg"), catchment_ids)

    feature_ids = [int(cid.split("-")[1]) for cid in catchment_ids]
    if troute in ("nc", "both"):
        _write_troute_netcdf(os.path.join(troute_dir, "troute_output.nc"), feature_ids, times)
    if troute in ("csv", "both"):
        _write_troute_csv(os.path.join(troute_dir, "troute_output.csv"), feature_ids, times)

    if realization:
        with open(os.path.join(config_dir, "realization.json"), "w") as handle:
            json.dump({"output_root": "./outputs/ngen"}, handle)

    return root


@pytest.fixture
def mini_run_factory(tmp_path):
    """Build mini runs on demand, each in its own directory."""
    counter = {"n": 0}

    def factory(**kwargs):
        counter["n"] += 1
        root = tmp_path / f"run-{counter['n']}"
        root.mkdir()
        return build_mini_run(root, **kwargs)

    return factory


@pytest.fixture
def mini_run(mini_run_factory):
    """The default run: three catchments, csv outputs, NetCDF t-route."""
    return mini_run_factory()
