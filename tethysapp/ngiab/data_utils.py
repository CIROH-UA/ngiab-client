import logging
import os
import sqlite3
import json
import fsspec
import tempfile
import pandas as pd
import xarray as xr
from urllib.parse import urlparse
import io
import pyarrow as pa
logger = logging.getLogger(__name__)

USGS_NWM30_XWALK = "s3://ciroh-rti-public-data/teehr-data-warehouse/common/crosswalks/usgs_nwm30_crosswalk.conus.parquet"  # noqa
USGS_POINT_GEOMETRY = "s3://ciroh-rti-public-data/teehr-data-warehouse/common/geometry/usgs_point_geometry.all.parquet"  # noqa


def get_usgs_nwm30_crosswalk():
    return pd.read_parquet(
        USGS_NWM30_XWALK,
        storage_options={
            "client_kwargs":
                {"region_name": "us-east-2"},
                "anon": True
            }
        )

def _get_gages_from_local_gpkg(path: str):
    """Internal helper that runs the SQLite logic on a local .gpkg file."""
    # 1) Figure out if the hydrofabric is v2.0.1 or v2.2
    #    v2.2 has a 'pois' table; v2.0.1 does not.
    with sqlite3.connect(path) as conn:
        (pois_count,) = conn.execute(
            "SELECT count(*) FROM gpkg_contents WHERE table_name = 'pois'"
        ).fetchone()

    if pois_count == 0:
        # v2.0.1: use flowpath_attributes.rl_gages
        with sqlite3.connect(path) as conn:
            rows = conn.execute(
                """
                SELECT id, rl_gages
                FROM flowpath_attributes
                WHERE rl_gages IS NOT NULL
                """
            ).fetchall()
        # Take only the first gage if multiple are listed
        results = [(r[0], r[1].split(",")[0]) for r in rows]
    else:
        # v2.2: use "flowpath-attributes".gage
        with sqlite3.connect(path) as conn:
            results = conn.execute(
                """
                SELECT id, gage
                FROM "flowpath-attributes"
                WHERE gage IS NOT NULL
                """
            ).fetchall()

    return results


def get_gages_from_hydrofabric_remote(url: str, *, anon: bool = True, **storage_options):
    """
    Ref: https://github.com/JoshCu/ngiab_eval/blob/2e8fd96b21a369bb93b2a491b0c303a4018a290e/ngiab_eval/core.py
    Get the gages from the hydrofabric GeoPackage.

    `url` can be:
      - s3://bucket/path/to/file.gpkg   (most common here)
      - local path: /path/to/file.gpkg
      - other fsspec URLs (if desired, with tweaks)
    """

    parsed = urlparse(url)

    # --- S3 case -----------------------------------------------------
    if parsed.scheme == "s3":
        # Build "bucket/key" for fsspec
        remote_path = f"{parsed.netloc}{parsed.path}"

        fs = fsspec.filesystem("s3", anon=anon, **storage_options)

        # Download to a temporary local file and run SQLite on that
        with tempfile.NamedTemporaryFile(suffix=".gpkg") as tmp:
            fs.get(remote_path, tmp.name)  # download S3 -> tmp.name
            return _get_gages_from_local_gpkg(tmp.name)

    # --- Local path (no scheme) --------------------------------------
    if parsed.scheme == "":
        # e.g., "/path/to/file.gpkg"
        return _get_gages_from_local_gpkg(url)

    # --- Other schemes (http/https/etc.) – optional extension --------
    # You could add http(s) handling here with fs = fsspec.filesystem(parsed.scheme)
    raise ValueError(f"Unsupported URL scheme for hydrofabric: {parsed.scheme!r}")

def get_simulation_start_end_time_remote(path: str):
    """
    Get start and end time of the simulation from a realization.json file.
    Ref: https://github.com/JoshCu/ngiab_eval/blob/2e8fd96b21a369bb93b2a491b0c303a4018a290e/ngiab_eval/core.py#L77 # noqa
    `path` can be:
      - s3://bucket/path/to/realization.json
      - https://.../realization.json
      - /local/path/realization.json
    """
    # anon=True is handy for public S3 buckets; harmless for local/http
    with fsspec.open(path, "rt", anon=True) as f:
        realization = json.load(f)

    time_cfg = realization["time"]
    return time_cfg["start_time"], time_cfg["end_time"]


def merge_usgs_nwm30_crosswalk(df, ngen_usgs_gages, usgs_nwm_xwalk_df):
    for gage_pair in ngen_usgs_gages:
        if "usgs-" + gage_pair[1] not in usgs_nwm_xwalk_df.index:
            df["usgs_id"] = None
            df["nwm_id"] = None
        else:
            df["usgs_id"] = "usgs-" + gage_pair[1]
            df["nwm_id"] = usgs_nwm_xwalk_df["secondary_location_id"].loc[
                "usgs-" + gage_pair[1]
            ]
    return df

def merge_usgs_nwm30_crosswalk_nc(df, ngen_usgs_gages, usgs_nwm_xwalk_df):
    """
    Attach ngen_id, usgs_id, and nwm_id to each feature_id row in df.

    Parameters
    ----------
    df : DataFrame
        Must have column 'feature_id'.
    ngen_usgs_gages : iterable of (ngen_flowpath_id, usgs_gage_id)
        E.g. ('wb-2855078', '01234567').
    usgs_nwm_xwalk_df : DataFrame
        Indexed by 'primary_location_id' (e.g. 'usgs-01234567') with
        column 'secondary_location_id' containing the NWM ID.
    """

    rows = []

    for ngen_raw, usgs_raw in ngen_usgs_gages:
        # ngen_raw might look like "wb-2855078" → we want "2855078"
        flowpath_token = str(ngen_raw).split("-")[-1]

        try:
            feature_id = int(flowpath_token)
        except ValueError:
            # If it doesn’t parse cleanly to int, skip it
            continue

        usgs_key = f"usgs-{usgs_raw}"

        # Skip if not present in the crosswalk
        if usgs_key not in usgs_nwm_xwalk_df.index:
            continue

        nwm_id = usgs_nwm_xwalk_df.loc[usgs_key, "secondary_location_id"]

        rows.append(
            {
                "feature_id": feature_id,
                "ngen_id": f"ngen-{flowpath_token}",
                "usgs_id": usgs_key,
                "nwm_id": nwm_id,
            }
        )

    if not rows:
        # nothing matched; just add empty columns if they don't exist and return
        for col in ["ngen_id", "usgs_id", "nwm_id"]:
            if col not in df.columns:
                df[col] = pd.NA
        return df

    xwalk_df = pd.DataFrame(rows)

    # If the same feature_id appears multiple times, keep the first
    xwalk_df = xwalk_df.drop_duplicates(subset="feature_id").set_index("feature_id")

    # Join on feature_id (which you *do* have in nc_df)
    df = df.join(xwalk_df, on="feature_id", how="left")

    return df

def get_troute_df(s3_nc_url: str) -> pd.DataFrame:
    """Load the t-route crosswalk DataFrame."""

    nc_xarray = xr.open_dataset(
        s3_nc_url,
        engine="h5netcdf",
        backend_kwargs={"storage_options": {"anon": True}},
    )
    nc_df = nc_xarray.to_dataframe()
    nc_df = nc_df.reset_index()

    return nc_df

def get_usgs_nwm_xwalk_df() -> pd.DataFrame:
    """Load the USGS-NWM 3.0 crosswalk DataFrame."""
    
    usgs_nwm_xwalk_df = get_usgs_nwm30_crosswalk()
    usgs_nwm_xwalk_df = usgs_nwm_xwalk_df.set_index("primary_location_id")
    return usgs_nwm_xwalk_df


def convert_nc_2_df(s3_nc_url: str, s3_gpkg_url: str) -> pd.DataFrame:
    """Convert NetCDF files to Parquet format."""
    
    df = get_troute_df(s3_nc_url)
    ngen_usgs_gages = get_gages_from_hydrofabric_remote(
        s3_gpkg_url,
        anon=True,
    )
    usgs_nwm_xwalk_df = get_usgs_nwm_xwalk_df()
    complete_df = merge_usgs_nwm30_crosswalk_nc(df,ngen_usgs_gages,usgs_nwm_xwalk_df)
    return complete_df

def convert_df_2_bytes(df: pd.DataFrame) -> bytes:
    """Convert NetCDF files to Parquet format."""
    
    table = pa.Table.from_pandas(df)
    buf = io.BytesIO()
    with pa.ipc.new_stream(buf, table.schema) as writer:
        writer.write_table(table)

    buf.seek(0)
    return buf.read()


