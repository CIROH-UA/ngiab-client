FROM python:3.11.11-slim-bookworm

WORKDIR /app

# System deps (kept minimal; GDAL is optional here, can be removed if unused)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
RUN pip install --no-cache-dir xarray pandas fsspec s3fs h5netcdf pyarrow

# Copy your code into the image
# This puts utils.py and nc2parquet.py directly in /app
COPY nc2parquet/ /app/

# Default environment variables (can be overridden with -e at runtime)
ENV S3_NC_URL="s3://ciroh-community-ngen-datastream/v2.2/ngen.20251119/short_range/16/VPU_16/ngen-run/outputs/troute/troute_output_202511191700.nc"
ENV S3_GPKG_URL="s3://ciroh-community-ngen-datastream/v2.2_resources/VPU_16/config/nextgen_VPU_16.gpkg"
ENV OUTPUT_PATH="/data/output.parquet"

# Ensure that /data exists (where OUTPUT_PATH points by default)
RUN mkdir -p /data

ENTRYPOINT ["python", "nc2parquet.py"]
