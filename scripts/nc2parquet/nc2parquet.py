
import logging
import os
from utils import (
    get_troute_df,
    get_usgs_nwm_xwalk_df,
    merge_usgs_nwm30_crosswalk_nc,
    get_gages_from_hydrofabric_remote,
)

logger = logging.getLogger(__name__)

def convert_nc_2_parquet(s3_nc_url: str, s3_gpkg_url: str, output_path: str) -> None:
    """Convert NetCDF files to Parquet format."""
    df = get_troute_df(s3_nc_url)
    ngen_usgs_gages = get_gages_from_hydrofabric_remote(
        s3_gpkg_url,
        anon=True,
    )
    usgs_nwm_xwalk_df = get_usgs_nwm_xwalk_df()
    complete_df = merge_usgs_nwm30_crosswalk_nc(df,ngen_usgs_gages,usgs_nwm_xwalk_df)
    
    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    complete_df.to_parquet(output_path)

if __name__ == "__main__":
    
    S3_NC_URL = os.getenv("S3_NC_URL", "")
    S3_GPKG_URL = os.getenv("S3_GPKG_URL", "")
    OUTPUT_PATH = os.getenv("OUTPUT_PATH", "")

    if not S3_NC_URL or not S3_GPKG_URL or not OUTPUT_PATH:
        raise ValueError("Please set S3_NC_URL, S3_GPKG_URL, and OUTPUT_PARKET_PATH environment variables.")
    
    convert_nc_2_parquet(
        s3_nc_url=S3_NC_URL,
        s3_gpkg_url=S3_GPKG_URL,
        output_path=OUTPUT_PATH,
    )