#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 2 ]]; then
  echo "Usage: gpkg2parquet.sh <S3_GPKG_1> [<S3_GPKG_2> ...] <OUTPUT_PARQUET_PATH>" >&2
  echo "Examples:" >&2
  echo "  gpkg2parquet.sh s3://ciroh-community-ngen-datastream/v2.2_resources/VPU_01/config/nextgen_VPU_01.gpkg /data/nexus_index.parquet" >&2
  echo "  gpkg2parquet.sh \\" >&2
  echo "    v2.2_resources/VPU_01/config/nextgen_VPU_01.gpkg \\" >&2
  echo "    v2.2_resources/VPU_02/config/nextgen_VPU_02.gpkg \\" >&2
  echo "    /data/nexus_divides_index.parquet" >&2
  exit 1
fi

# Last argument = output Parquet; all prior = input GPKG S3 paths
OUTPUT_PARQUET="${@: -1}"
INPUT_PATHS=("${@:1:$#-1}")
BUCKET="${GPKG_BUCKET:-ciroh-community-ngen-datastream}"

# Layers to process, comma-separated, e.g. "nexus,divides"
LAYER_SPEC="${GPKG_LAYERS:-nexus}"
IFS=',' read -r -a LAYERS <<< "${LAYER_SPEC}"

echo ">> Layers to extract: ${LAYERS[*]}"
echo ">> Output Parquet:    ${OUTPUT_PARQUET}"

# Put all CSVs in a dedicated temp dir
CSV_DIR="$(mktemp -d /tmp/gpkg2parquet_csvs.XXXXXX)"
CSV_FILES=()

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
  aws s3 cp "${S3_URL}" "${LOCAL_GPKG}" --no-sign-request

  if [[ ! -s "${LOCAL_GPKG}" ]]; then
    echo "!! Download failed or empty file: ${LOCAL_GPKG}" >&2
    exit 1
  fi

  # For each requested layer in this GPKG
  for LAYER in "${LAYERS[@]}"; do
    LAYER_TRIMMED="$(echo "${LAYER}" | xargs)"  # strip spaces
    [[ -z "${LAYER_TRIMMED}" ]] && continue

    LOCAL_CSV="${CSV_DIR}/$(basename "${BASENAME%.*}")_${LAYER_TRIMMED}.csv"
    echo ">> Extracting layer '${LAYER_TRIMMED}' from ${LOCAL_GPKG} -> ${LOCAL_CSV}"

    # Build layer-specific SQL: map to a common schema: layer, id, lon, lat
    case "${LAYER_TRIMMED}" in
      nexus)
        SQL="SELECT 'nexus' AS layer,
                     id AS id,
                     ST_X(ST_Centroid(geom)) AS lon,
                     ST_Y(ST_Centroid(geom)) AS lat
              FROM \"nexus\"
              WHERE ST_IsEmpty(geom)=0"
        ;;
      divides)
        SQL="SELECT 'divides' AS layer,
                     divide_id AS id,
                     ST_X(ST_Centroid(geom)) AS lon,
                     ST_Y(ST_Centroid(geom)) AS lat
              FROM \"divides\"
              WHERE ST_IsEmpty(geom)=0"
        ;;
      *)
        echo "!! Unsupported layer '${LAYER_TRIMMED}' – skipping" >&2
        continue
        ;;
    esac

    ogr2ogr -f CSV "${LOCAL_CSV}" "${LOCAL_GPKG}" "${LAYER_TRIMMED}" \
      -dialect SQLite \
      -sql "${SQL}" || {
        echo "!! ogr2ogr failed for ${LOCAL_GPKG} (layer ${LAYER_TRIMMED})" >&2
        exit 2
      }

    if [[ ! -s "${LOCAL_CSV}" ]]; then
      echo "!! CSV file was not created or is empty: ${LOCAL_CSV}" >&2
      exit 3
    fi

    CSV_FILES+=("${LOCAL_CSV}")
  done
done

if [[ "${#CSV_FILES[@]}" -eq 0 ]]; then
  echo "!! No CSV files were generated; nothing to write to Parquet." >&2
  exit 4
fi

echo ">> Merging ${#CSV_FILES[@]} CSVs into Parquet via DuckDB CLI…"

# Build DuckDB list literal: ['file1.csv', 'file2.csv', ...]
FILES_LIST=""
for f in "${CSV_FILES[@]}"; do
  esc=${f//\'/\'\'}
  if [[ -z "${FILES_LIST}" ]]; then
    FILES_LIST="'${esc}'"
  else
    FILES_LIST="${FILES_LIST}, '${esc}'"
  fi
done

# DuckDB SQL: read all CSVs, union by name, write Parquet
duckdb -c "COPY (
  SELECT *
  FROM read_csv_auto([${FILES_LIST}], union_by_name=true)
) TO '${OUTPUT_PARQUET}' (FORMAT PARQUET);"

echo ">> Done. Parquet written to ${OUTPUT_PARQUET}"
