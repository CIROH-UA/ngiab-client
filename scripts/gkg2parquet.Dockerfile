FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive

ADD gpkg2parquet/gpkg2parquet.sh /usr/local/bin/gpkg2parquet.sh

WORKDIR /data

# Base tools + GDAL + AWS CLI + unzip (for DuckDB CLI)
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
      curl ca-certificates gdal-bin coreutils findutils tar gzip awscli unzip && \
    rm -rf /var/lib/apt/lists/*

# Install DuckDB CLI (supports amd64 and arm64)
RUN set -eux; \
    ARCH="$(uname -m)"; \
    if [ "$ARCH" = "x86_64" ]; then \
      DUCKDB_ZIP="duckdb_cli-linux-amd64.zip"; \
    elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
      DUCKDB_ZIP="duckdb_cli-linux-arm64.zip"; \
    else \
      echo "Unsupported architecture: $ARCH" >&2; exit 1; \
    fi; \
    TMPDIR="$(mktemp -d)"; \
    curl -fsSL "https://install.duckdb.org/v1.4.2/${DUCKDB_ZIP}" -o "${TMPDIR}/duckdb.zip"; \
    unzip "${TMPDIR}/duckdb.zip" -d "${TMPDIR}"; \
    install -m 0755 "${TMPDIR}/duckdb" /usr/local/bin/duckdb; \
    rm -rf "${TMPDIR}"

# Default bucket (can be overridden at runtime)
ENV GPKG_BUCKET=ciroh-community-ngen-datastream

# Entry point script:
#   args 1..N-1 = S3 GPKG paths (several accepted forms)
#   arg N       = output .parquet path (local path in container, e.g. /data/nexus_index.parquet)
#
# Optional env vars:
#   GPKG_LAYER  = layer name (default: nexus)
RUN mkdir -p /usr/local/bin


RUN chmod +x /usr/local/bin/gpkg2parquet.sh

ENTRYPOINT ["/usr/local/bin/gpkg2parquet.sh"]
