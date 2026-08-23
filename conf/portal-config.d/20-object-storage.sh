#!/usr/bin/env bash
#
# Point Django's default storage at an object store, so runs can live in a bucket.
#
# Only fires when NGIAB_STORAGE_BACKEND=s3, which is the same switch run_store and
# duckdb_conn read. Anything else leaves the portal exactly as it is: a laptop container
# needs none of this and configures nothing.
#
# It sets `default`, not a dedicated alias, because that is the shape a real portal already
# has -- one bucket configured once, holding media -- and run_store borrows it, keeping runs
# under NGIAB_RUNS_PREFIX. Deployments installing the app into an existing Tethys portal do
# not need this hook at all: their portal already defines STORAGES, and the app inherits it.
# This exists so the container can rehearse that arrangement.
#
# DuckDB is not configured here. It reads the same credentials back out of the resolved
# storage object at connection time, so there is one place they are written down.
#
# With no access key the OPTIONS carry none, and both halves fall back to the ambient
# credential chain -- instance role, workload identity, or a mounted profile.

if [ "${NGIAB_STORAGE_BACKEND:-}" != "s3" ]; then
    return 0 2>/dev/null || exit 0
fi

if [ -z "${NGIAB_S3_BUCKET:-}" ]; then
    echo "[portal-config] NGIAB_STORAGE_BACKEND=s3 but NGIAB_S3_BUCKET is unset" >&2
    return 0 2>/dev/null || exit 0
fi

ngiab_storages_json() {
    NGIAB_S3_BUCKET="${NGIAB_S3_BUCKET}" \
    NGIAB_S3_ENDPOINT="${NGIAB_S3_ENDPOINT:-}" \
    NGIAB_S3_REGION="${AWS_DEFAULT_REGION:-${AWS_REGION:-}}" \
    NGIAB_S3_KEY="${AWS_ACCESS_KEY_ID:-}" \
    NGIAB_S3_SECRET="${AWS_SECRET_ACCESS_KEY:-}" \
    python - <<'PY'
import json, os

options = {"bucket_name": os.environ["NGIAB_S3_BUCKET"]}
for key, name in (
    ("NGIAB_S3_ENDPOINT", "endpoint_url"),
    ("NGIAB_S3_REGION", "region_name"),
    ("NGIAB_S3_KEY", "access_key"),
    ("NGIAB_S3_SECRET", "secret_key"),
):
    if os.environ.get(key):
        options[name] = os.environ[key]

# Path-style addressing for a custom endpoint: virtual-host style resolves bucket.minio,
# which does not exist. Matches what run_store tells DuckDB.
if os.environ.get("NGIAB_S3_ENDPOINT"):
    options["addressing_style"] = "path"

print(json.dumps({
    "default": {"BACKEND": "storages.backends.s3.S3Storage", "OPTIONS": options},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}))
PY
}

echo "[portal-config] runs in s3://${NGIAB_S3_BUCKET}/${NGIAB_RUNS_PREFIX:-ngiab_visualizer}"
tethys settings --set STORAGES "$(ngiab_storages_json)"
