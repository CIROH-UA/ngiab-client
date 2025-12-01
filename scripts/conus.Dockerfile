# # Stage 1: get tippecanoe + tile-join
# FROM ghcr.io/jtmiclat/tippecanoe-docker:latest AS tippecanoe

# # Stage 2: slim runtime + GDAL + awscli + pmtiles + our script
# FROM debian:trixie-slim

# ENV DEBIAN_FRONTEND=noninteractive

# # Base tools + GDAL + AWS CLI
# RUN apt-get update -y && \
#     apt-get install -y --no-install-recommends \
#       curl ca-certificates gdal-bin coreutils findutils tar gzip awscli && \
#     rm -rf /var/lib/apt/lists/*

# # Copy tippecanoe & friends from the first stage
# COPY --from=tippecanoe /usr/local/bin/ /usr/local/bin/

# # Install pmtiles binary
# RUN set -eux; \
#     TMPDIR="$(mktemp -d)"; \
#     curl -fsSL "https://github.com/protomaps/go-pmtiles/releases/download/v1.28.1/go-pmtiles_1.28.1_Linux_x86_64.tar.gz" \
#       -o "${TMPDIR}/pmtiles.tar.gz"; \
#     tar -xzf "${TMPDIR}/pmtiles.tar.gz" -C "${TMPDIR}" pmtiles; \
#     install -m 0755 "${TMPDIR}/pmtiles" /usr/local/bin/pmtiles; \
#     rm -rf "${TMPDIR}"

# WORKDIR /data

# # Default bucket (can be overridden at runtime)
# ENV GPKG_BUCKET=ciroh-community-ngen-datastream

# # Entry point script:
# #   args 1..N-1 = S3 paths (several accepted forms)
# #   arg N       = output .pmtiles path
# RUN mkdir -p /usr/local/bin && \
#     cat << 'EOF' > /usr/local/bin/gpkg2pmtiles.sh
# #!/usr/bin/env bash
# set -euo pipefail

# if [[ "$#" -lt 2 ]]; then
#   echo "Usage: gpkg2pmtiles.sh <S3_GPKG_1> [<S3_GPKG_2> ...] <OUTPUT_PM_PATH>" >&2
#   echo "Examples:" >&2
#   echo "  gpkg2pmtiles.sh s3://ciroh-community-ngen-datastream/v2.2_resources/VPU_01/config/nextgen_VPU_01.gpkg /data/nextgen_VPU_01.pmtiles" >&2
#   echo "  gpkg2pmtiles.sh \\" >&2
#   echo "    v2.2_resources/VPU_01/config/nextgen_VPU_01.gpkg \\" >&2
#   echo "    v2.2_resources/VPU_02/config/nextgen_VPU_02.gpkg \\" >&2
#   echo "    /data/nextgen_VPU_01_02.pmtiles" >&2
#   exit 1
# fi

# # Last argument = output PMTiles; all prior = input GPKG S3 paths
# OUTPUT_PM="${@: -1}"
# INPUT_PATHS=("${@:1:$#-1}")
# BUCKET="${GPKG_BUCKET:-ciroh-community-ngen-datastream}"

# gpkg_to_mbtiles() {
#   local GPKG="$1"
#   local OUT_MB="$2"

#   command -v ogrinfo     >/dev/null || { echo "ogrinfo not found"; return 2; }
#   command -v ogr2ogr     >/dev/null || { echo "ogr2ogr not found"; return 2; }
#   command -v tippecanoe  >/dev/null || { echo "tippecanoe not found"; return 2; }
#   command -v tile-join   >/dev/null || { echo "tile-join not found"; return 2; }

#   local LAYERS=(flowpaths divides lakes hydrolocations nexus)
#   local WORK
#   WORK="$(mktemp -d "${TMPDIR:-/tmp}/gpkg2mbtiles.XXXXXX")"
#   trap 'rm -rf "${WORK}"' RETURN

#   echo ">> Working dir: ${WORK}"

#   fc() {
#     local layer="$1"
#     ogrinfo -so "${GPKG}" "${layer}" 2>/dev/null | awk -F': ' '/Feature Count/ {print $2+0}' || echo 0
#   }

#   local EXPORTED=()
#   local L
#   for L in "${LAYERS[@]}"; do
#     local COUNT
#     COUNT="$(fc "${L}")"
#     if [[ "${COUNT}" -eq 0 ]]; then
#       echo ">> Skipping '${L}' (0 features)"
#       continue
#     fi
#     echo ">> Exporting '${L}' (${COUNT} features) …"
#     ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 -lco RS=NO \
#       -dialect SQLite -sql "SELECT * FROM \"${L}\" WHERE ST_IsEmpty(geom)=0" \
#       "${WORK}/${L}.ndjson" "${GPKG}" "${L}" || {
#         echo "!! Export failed for '${L}', skipping"; continue;
#       }
#     if ! [[ -s "${WORK}/${L}.ndjson" ]]; then
#       echo ">> '${L}' produced no valid geometries after filtering, skipping"
#       continue
#     fi
#     EXPORTED+=("${L}")
#   done

#   if [[ "${#EXPORTED[@]}" -eq 0 ]]; then
#     echo "No non-empty layers to build for ${GPKG}."
#     return 0
#   fi

#   local MB_DIR="${WORK}/mb"
#   mkdir -p "${MB_DIR}"

#   build_layer () {
#     local LAYER="$1"
#     local INPUT="${WORK}/${LAYER}.ndjson"
#     local OUT_FILE="${MB_DIR}/${LAYER}.mbtiles"
#     [[ ! -s "${INPUT}" ]] && { echo ">> '${LAYER}' has no data, skip build"; return; }
#     echo ">> Building ${LAYER} …"

#     # You can tweak these if needed
#     local MIN_ZOOM="${TIPPE_MIN_ZOOM:-0}"
#     local MAX_ZOOM="${TIPPE_MAX_ZOOM:-12}"

#     if [[ "${LAYER}" == "nexus" ]]; then
#       tippecanoe \
#         -Z "${MIN_ZOOM}" \
#         -z "${MAX_ZOOM}" \
#         -o "${OUT_FILE}" \
#         -l "${LAYER}" \
#         -r1 \
#         --cluster-distance=10 \
#         ${ACC_ATTR:+--accumulate-attribute="${ACC_ATTR}"} \
#         "${INPUT}"
#     else
#       tippecanoe \
#         -Z "${MIN_ZOOM}" \
#         -z "${MAX_ZOOM}" \
#         -o "${OUT_FILE}" \
#         -l "${LAYER}" \
#         --no-tile-size-limit \
#         --no-feature-limit \
#         "${INPUT}"
#     fi
#   }

#   for L in "${EXPORTED[@]}"; do
#     build_layer "${L}"
#   done

#   local MB_LIST=()
#   for L in "${EXPORTED[@]}"; do
#     [[ -s "${MB_DIR}/${L}.mbtiles" ]] && MB_LIST+=("${MB_DIR}/${L}.mbtiles")
#   done

#   if [[ "${#MB_LIST[@]}" -eq 0 ]]; then
#     echo "No layer MBTiles were created for ${GPKG}."
#     return 0
#   fi

#   echo ">> Merging layers into per-GPKG MBTiles: ${OUT_MB} …"
#   tile-join -o "${OUT_MB}" --no-tile-size-limit "${MB_LIST[@]}"
#   echo "Wrote ${OUT_MB}"
#   return 0
# }

# TMP_MBS=()

# # Loop over all input GPKG S3 paths
# for INPUT_PATH in "${INPUT_PATHS[@]}"; do
#   # Normalize INPUT_PATH into a full s3:// URL
#   if [[ "${INPUT_PATH}" == s3://* ]]; then
#     S3_URL="${INPUT_PATH}"
#   elif [[ "${INPUT_PATH}" == "${BUCKET}/"* ]]; then
#     # includes bucket already, but missing s3://
#     S3_URL="s3://${INPUT_PATH}"
#   else
#     # treat as a key under the default bucket
#     S3_URL="s3://${BUCKET}/${INPUT_PATH}"
#   fi

#   echo ">> Using S3 URL: ${S3_URL}"

#   BASENAME="$(basename "${S3_URL}")"
#   if [[ -z "${BASENAME}" || "${BASENAME}" == "${S3_URL}" ]]; then
#     BASENAME="input.gpkg"
#   fi

#   LOCAL_GPKG="/tmp/${BASENAME}"

#   echo ">> Downloading ${S3_URL} -> ${LOCAL_GPKG}"
#   # For public buckets, --no-sign-request avoids needing creds
#   aws s3 cp "${S3_URL}" "${LOCAL_GPKG}" --no-sign-request

#   if [[ ! -s "${LOCAL_GPKG}" ]]; then
#     echo "!! Download failed or empty file: ${LOCAL_GPKG}" >&2
#     exit 1
#   fi

#   # Unique MBTiles per GPKG
#   TMP_MB="$(mktemp /tmp/gpkg_XXXXXX.mbtiles)"

#   echo ">> Converting GPKG to MBTiles: ${LOCAL_GPKG} -> ${TMP_MB}"
#   if ! gpkg_to_mbtiles "${LOCAL_GPKG}" "${TMP_MB}"; then
#     echo "!! Failed to create MBTiles for ${LOCAL_GPKG}" >&2
#     exit 2
#   fi

#   if [[ ! -s "${TMP_MB}" ]]; then
#     echo "!! MBTiles file was not created or is empty: ${TMP_MB}" >&2
#     exit 3
#   fi

#   TMP_MBS+=("${TMP_MB}")
# done

# MERGED_MB="/tmp/merged.mbtiles"

# if [[ "${#TMP_MBS[@]}" -eq 1 ]]; then
#   echo ">> Only one MBTiles produced; copying to ${MERGED_MB}"
#   cp "${TMP_MBS[0]}" "${MERGED_MB}"
# else
#   echo ">> Merging ${#TMP_MBS[@]} per-GPKG MBTiles into ${MERGED_MB} …"
#   tile-join -o "${MERGED_MB}" --no-tile-size-limit "${TMP_MBS[@]}"
# fi

# mkdir -p "$(dirname "${OUTPUT_PM}")"

# echo ">> Converting merged MBTiles to PMTiles: ${MERGED_MB} -> ${OUTPUT_PM}"
# pmtiles convert "${MERGED_MB}" "${OUTPUT_PM}"

# echo "Wrote PMTiles to ${OUTPUT_PM}"
# EOF

# RUN chmod +x /usr/local/bin/gpkg2pmtiles.sh

# ENTRYPOINT ["/usr/local/bin/gpkg2pmtiles.sh"]

# Stage 1: get tippecanoe + tile-join
FROM ghcr.io/jtmiclat/tippecanoe-docker:latest AS tippecanoe

# Stage 2: slim runtime + GDAL + awscli + pmtiles + our script
FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive

# Base tools + GDAL + AWS CLI
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
      curl ca-certificates gdal-bin coreutils findutils tar gzip awscli && \
    rm -rf /var/lib/apt/lists/*

# Copy tippecanoe & friends from the first stage
COPY --from=tippecanoe /usr/local/bin/ /usr/local/bin/

# Install pmtiles binary
RUN set -eux; \
    TMPDIR="$(mktemp -d)"; \
    curl -fsSL "https://github.com/protomaps/go-pmtiles/releases/download/v1.28.1/go-pmtiles_1.28.1_Linux_x86_64.tar.gz" \
      -o "${TMPDIR}/pmtiles.tar.gz"; \
    tar -xzf "${TMPDIR}/pmtiles.tar.gz" -C "${TMPDIR}" pmtiles; \
    install -m 0755 "${TMPDIR}/pmtiles" /usr/local/bin/pmtiles; \
    rm -rf "${TMPDIR}"

WORKDIR /data

# Default bucket (can be overridden at runtime)
ENV GPKG_BUCKET=ciroh-community-ngen-datastream

# Entry point script:
#   args 1..N-1 = S3 paths (several accepted forms)
#   arg N       = output .pmtiles path
RUN mkdir -p /usr/local/bin && \
    cat << 'EOF' > /usr/local/bin/gpkg2pmtiles.sh
#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 2 ]]; then
  echo "Usage: gpkg2pmtiles.sh <S3_GPKG_1> [<S3_GPKG_2> ...] <OUTPUT_PM_PATH>" >&2
  echo "Examples:" >&2
  echo "  gpkg2pmtiles.sh s3://ciroh-community-ngen-datastream/v2.2_resources/VPU_01/config/nextgen_VPU_01.gpkg /data/nextgen_VPU_01.pmtiles" >&2
  echo "  gpkg2pmtiles.sh \\" >&2
  echo "    v2.2_resources/VPU_01/config/nextgen_VPU_01.gpkg \\" >&2
  echo "    v2.2_resources/VPU_02/config/nextgen_VPU_02.gpkg \\" >&2
  echo "    /data/nextgen_VPU_01_02.pmtiles" >&2
  exit 1
fi

# Last argument = output PMTiles; all prior = input GPKG S3 paths
OUTPUT_PM="${@: -1}"
INPUT_PATHS=("${@:1:$#-1}")
BUCKET="${GPKG_BUCKET:-ciroh-community-ngen-datastream}"

gpkg_to_mbtiles() {
  local GPKG="$1"
  local OUT_MB="$2"

  command -v ogrinfo     >/dev/null || { echo "ogrinfo not found"; return 2; }
  command -v ogr2ogr     >/dev/null || { echo "ogr2ogr not found"; return 2; }
  command -v tippecanoe  >/dev/null || { echo "tippecanoe not found"; return 2; }
  command -v tile-join   >/dev/null || { echo "tile-join not found"; return 2; }

  # Only build the 'nexus' layer by default, or override with env:
  #   GPKG_LAYERS="nexus,hydrolocations"
  local LAYERS_STR="${GPKG_LAYERS:-nexus}"
  IFS=',' read -r -a LAYERS <<< "${LAYERS_STR}"

  local WORK
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/gpkg2mbtiles.XXXXXX")"
  trap 'rm -rf "${WORK}"' RETURN

  echo ">> Working dir: ${WORK}"
  echo ">> Layers to process: ${LAYERS[*]}"

  fc() {
    local layer="$1"
    ogrinfo -so "${GPKG}" "${layer}" 2>/dev/null | awk -F': ' '/Feature Count/ {print $2+0}' || echo 0
  }

  local EXPORTED=()
  local L
  for L in "${LAYERS[@]}"; do
    local COUNT
    COUNT="$(fc "${L}")"
    if [[ "${COUNT}" -eq 0 ]]; then
      echo ">> Skipping '${L}' (0 features)"
      continue
    fi
    echo ">> Exporting '${L}' (${COUNT} features) …"
    ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 -lco RS=NO \
      -dialect SQLite -sql "SELECT * FROM \"${L}\" WHERE ST_IsEmpty(geom)=0" \
      "${WORK}/${L}.ndjson" "${GPKG}" "${L}" || {
        echo "!! Export failed for '${L}', skipping"; continue;
      }
    if ! [[ -s "${WORK}/${L}.ndjson" ]]; then
      echo ">> '${L}' produced no valid geometries after filtering, skipping"
      continue
    fi
    EXPORTED+=("${L}")
  done

  if [[ "${#EXPORTED[@]}" -eq 0 ]]; then
    echo "No non-empty layers to build for ${GPKG}."
    return 0
  fi

  local MB_DIR="${WORK}/mb"
  mkdir -p "${MB_DIR}"

  build_layer () {
    local LAYER="$1"
    local INPUT="${WORK}/${LAYER}.ndjson"
    local OUT_FILE="${MB_DIR}/${LAYER}.mbtiles"
    [[ ! -s "${INPUT}" ]] && { echo ">> '${LAYER}' has no data, skip build"; return; }
    echo ">> Building ${LAYER} …"

    # You can tweak these if needed
    local MIN_ZOOM="${TIPPE_MIN_ZOOM:-0}"
    local MAX_ZOOM="${TIPPE_MAX_ZOOM:-12}"

    if [[ "${LAYER}" == "nexus" ]]; then
      tippecanoe \
        -Z "${MIN_ZOOM}" \
        -z "${MAX_ZOOM}" \
        -o "${OUT_FILE}" \
        -l "${LAYER}" \
        -r1 \
        --cluster-distance=10 \
        ${ACC_ATTR:+--accumulate-attribute="${ACC_ATTR}"} \
        "${INPUT}"
    else
      tippecanoe \
        -Z "${MIN_ZOOM}" \
        -z "${MAX_ZOOM}" \
        -o "${OUT_FILE}" \
        -l "${LAYER}" \
        --no-tile-size-limit \
        --no-feature-limit \
        "${INPUT}"
    fi
  }

  local L2
  for L2 in "${EXPORTED[@]}"; do
    build_layer "${L2}"
  done

  local MB_LIST=()
  for L2 in "${EXPORTED[@]}"; do
    [[ -s "${MB_DIR}/${L2}.mbtiles" ]] && MB_LIST+=("${MB_DIR}/${L2}.mbtiles")
  done

  if [[ "${#MB_LIST[@]}" -eq 0 ]]; then
    echo "No layer MBTiles were created for ${GPKG}."
    return 0
  fi

  echo ">> Merging layers into per-GPKG MBTiles: ${OUT_MB} …"
  tile-join -o "${OUT_MB}" --no-tile-size-limit "${MB_LIST[@]}"
  echo "Wrote ${OUT_MB}"
  return 0
}

TMP_MBS=()

# Loop over all input GPKG S3 paths
for INPUT_PATH in "${INPUT_PATHS[@]}"; do
  # Normalize INPUT_PATH into a full s3:// URL
  if [[ "${INPUT_PATH}" == s3://* ]]; then
    S3_URL="${INPUT_PATH}"
  elif [[ "${INPUT_PATH}" == "${BUCKET}/"* ]]; then
    # includes bucket already, but missing s3://
    S3_URL="s3://${INPUT_PATH}"
  else
    # treat as a key under the default bucket
    S3_URL="s3://${BUCKET}/${INPUT_PATH}"
  fi

  echo ">> Using S3 URL: ${S3_URL}"

  BASENAME="$(basename "${S3_URL}")"
  if [[ -z "${BASENAME}" || "${BASENAME}" == "${S3_URL}" ]]; then
    BASENAME="input.gpkg"
  fi

  LOCAL_GPKG="/tmp/${BASENAME}"

  echo ">> Downloading ${S3_URL} -> ${LOCAL_GPKG}"
  # For public buckets, --no-sign-request avoids needing creds
  aws s3 cp "${S3_URL}" "${LOCAL_GPKG}" --no-sign-request

  if [[ ! -s "${LOCAL_GPKG}" ]]; then
    echo "!! Download failed or empty file: ${LOCAL_GPKG}" >&2
    exit 1
  fi

  # Unique MBTiles per GPKG
  TMP_MB="$(mktemp /tmp/gpkg_XXXXXX.mbtiles)"

  echo ">> Converting GPKG to MBTiles: ${LOCAL_GPKG} -> ${TMP_MB}"
  if ! gpkg_to_mbtiles "${LOCAL_GPKG}" "${TMP_MB}"; then
    echo "!! Failed to create MBTiles for ${LOCAL_GPKG}" >&2
    exit 2
  fi

  if [[ ! -s "${TMP_MB}" ]]; then
    echo "!! MBTiles file was not created or is empty: ${TMP_MB}" >&2
    exit 3
  fi

  TMP_MBS+=("${TMP_MB}")
done

MERGED_MB="/tmp/merged.mbtiles"

if [[ "${#TMP_MBS[@]}" -eq 1 ]]; then
  echo ">> Only one MBTiles produced; copying to ${MERGED_MB}"
  cp "${TMP_MBS[0]}" "${MERGED_MB}"
else
  echo ">> Merging ${#TMP_MBS[@]} per-GPKG MBTiles into ${MERGED_MB} …"
  tile-join -o "${MERGED_MB}" --no-tile-size-limit "${TMP_MBS[@]}"
fi

mkdir -p "$(dirname "${OUTPUT_PM}")"

echo ">> Converting merged MBTiles to PMTiles: ${MERGED_MB} -> ${OUTPUT_PM}"
pmtiles convert "${MERGED_MB}" "${OUTPUT_PM}"

echo "Wrote PMTiles to ${OUTPUT_PM}"
EOF

RUN chmod +x /usr/local/bin/gpkg2pmtiles.sh

ENTRYPOINT ["/usr/local/bin/gpkg2pmtiles.sh"]
