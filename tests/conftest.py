"""Fixtures for the endpoint-parity suite: a generated NGIAB run, not a committed fixture.
Run inside the image (docker build --target test), not a local conda environment."""

import json
import os

import numpy as np
import pandas as pd
import pytest

STEP_COLUMN = "Time Step"
TIME_COLUMN = "Time"

FABRIC_CRS = "EPSG:5070"

DEFAULT_VARIABLES = ("RAIN_RATE", "Q_OUT", "SOIL_STORAGE")


def _timestamps(count, start="2017-01-01 00:00:00", freq="h"):
    return pd.date_range(start=start, periods=count, freq=freq)


def _catchment_frame(index, times, variables):
    """One catchment's output, with values that differ per catchment and per variable."""
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
    """Convert with DuckDB, the way the shipped converter does."""
    import duckdb

    escaped_src = src.replace("'", "''")
    escaped_dst = dst.replace("'", "''")
    duckdb.execute(
        f"COPY (SELECT * FROM read_csv_auto('{escaped_src}')) "
        f"TO '{escaped_dst}' (FORMAT PARQUET, COMPRESSION ZSTD)"
    )


def _write_gpkg(path, catchment_ids):
    """A hydrofabric-shaped GeoPackage: divides, nexus, and the flowpaths crosswalk."""
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
    """T-route's NetCDF shape: a (feature_id, time) frame carrying CF metadata."""
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
    """T-route's flat csv shape, which the reader reaches by a different branch."""
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
    """Write one NGIAB-shaped run directory and return its path."""
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

    def factory(name=None, **kwargs):
        counter["n"] += 1
        root = tmp_path / (name or f"run-{counter['n']}")
        root.mkdir()
        return build_mini_run(root, **kwargs)

    return factory


@pytest.fixture
def mini_run(mini_run_factory):
    """The default run: three catchments, csv outputs, NetCDF t-route."""
    return mini_run_factory()


@pytest.fixture
def ingest(tmp_path, mini_run_factory, monkeypatch):
    """Put generated runs under a storage root and distill them, as ingest would."""
    from tethysapp.ngiab import duckdb_conn, manifest, run_store
    from tethysapp.ngiab import utils as ngiab_utils

    root = tmp_path / "ngiab_visualizer"
    root.mkdir()
    monkeypatch.delenv(duckdb_conn.STORAGE_BACKEND_ENV, raising=False)
    monkeypatch.setenv(run_store.MANAGED_ROOT_ENV, str(root))
    monkeypatch.setenv(run_store.LISTING_TTL_ENV, "0")

    def _ingest(name="alpha", *, created=None, legacy_uuids=(), **kwargs):
        source = mini_run_factory(name=f"src-{name}", **kwargs)
        document = manifest.distill(
            source,
            run_id=name,
            label=name,
            created=created or "2026-08-01T00:00:00+00:00",
            legacy_uuids=legacy_uuids,
        )
        manifest.write(source, document)
        os.rename(source, root / name)
        run_store.clear_caches()
        ngiab_utils._cached_catchment_variables.cache_clear()
        ngiab_utils._cached_value_matrix.cache_clear()
        return name

    _ingest.root = root
    return _ingest
