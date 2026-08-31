#!/usr/bin/env bash
#
# Stand up the visualizer against a local S3 (minio) and open it in a browser.
#
# This is a rehearsal of the hosted arrangement, not a second deployment mode: minio speaks
# the same API as the portal's bucket, the portal's media storage is what the run store
# borrows, and DuckDB takes its credentials back out of that. If a run reads here it reads
# on the portal.
#
# Usage:
#     scripts/try-object-storage.sh [prepared-run-directory] [port]
#
# With no run directory it starts empty, which is the way to exercise uploading.
#
# The run directory must already be converted. Mount the PARENT and pass the full path:
#     docker run --rm -v "$PWD:/runs" <image> /usr/local/bin/ngiab-convert.sh --path /runs/myrun
#
# Mounting the run itself at /run instead would name it "run": distill takes the id from the
# basename of the path it is given, so the mount point becomes the run's identity.
#
# Tear down with: scripts/try-object-storage.sh --down

set -euo pipefail

NET=ngiab-minio-net
MINIO=ngiab-minio
APP=ngiab-s3-app
BUCKET=portal-media
KEY=minioadmin
SECRET=minioadmin
IMAGE="${NGIAB_IMAGE:-ngiab-visualizer:local}"

down() {
    docker rm -f "$APP" "$MINIO" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
    echo "torn down"
}

if [ "${1:-}" = "--down" ]; then down; exit 0; fi

RUN_DIR="${1:-}"
PORT="${2:-8090}"
if [ -n "$RUN_DIR" ] && [ ! -d "$RUN_DIR" ]; then
    echo "usage: $0 [prepared-run-directory] [port]" >&2
    exit 1
fi
if [ -n "$RUN_DIR" ] && [ ! -f "$RUN_DIR/manifest.json" ]; then
    echo "error: $RUN_DIR has no manifest.json -- convert it first (see the header)" >&2
    exit 1
fi
RUN_ABS=""
RUN_NAME=""
if [ -n "$RUN_DIR" ]; then
    RUN_ABS="$(cd "$RUN_DIR" && pwd)"
    RUN_NAME="$(basename "$RUN_ABS")"
fi

if [ -n "$RUN_ABS" ]; then

# An unconverted run half-works on object storage, which is worse than not working: DuckDB
# globs the catchment CSVs over s3:// happily, but troute is still netCDF and xarray cannot
# open an s3:// URI at all, so every routing chart 500s. Converting is the hosted workflow,
# not an optimisation, so refuse rather than serve something broken.
TROUTE_FORMAT="$(python3 -c "
import json, sys
doc = json.load(open('$RUN_ABS/manifest.json'))
print((doc.get('troute') or {}).get('format', ''))
" 2>/dev/null || echo "")"
if [ "$TROUTE_FORMAT" = ".nc" ] || [ "$TROUTE_FORMAT" = ".csv" ]; then
    cat >&2 <<MSG
error: $RUN_NAME has unconverted t-route output ($TROUTE_FORMAT).

  Catchment data would load, but every routing chart would fail: xarray cannot open an
  s3:// URI. Convert it first, mounting the PARENT so the run keeps its name:

    docker run --rm -v "$(dirname "$RUN_ABS"):/runs" $IMAGE \
        /usr/local/bin/ngiab-convert.sh --path /runs/$RUN_NAME

MSG
    exit 1
fi

# The id the picker uses comes from the manifest, not the directory, and conversion stamps it
# from whatever path it was given. Catch a mismatch here rather than as an empty map.
MANIFEST_ID="$(python3 -c "
import json
print(json.load(open('$RUN_ABS/manifest.json')).get('id', ''))
" 2>/dev/null || echo "")"
if [ -n "$MANIFEST_ID" ] && [ "$MANIFEST_ID" != "$RUN_NAME" ]; then
    echo "error: $RUN_NAME carries manifest id '$MANIFEST_ID'." >&2
    echo "  The picker would offer '$MANIFEST_ID' and nothing would resolve. Re-convert with" >&2
    echo "  the parent mounted, so the basename matches the run." >&2
    exit 1
fi
fi

trap 'echo; echo "(leaving containers up; scripts/try-object-storage.sh --down to remove)"' INT

down >/dev/null 2>&1 || true
docker network create "$NET" >/dev/null

echo "[1/4] starting minio"
docker run -d --name "$MINIO" --network "$NET" \
    -e MINIO_ROOT_USER="$KEY" -e MINIO_ROOT_PASSWORD="$SECRET" \
    -p 9000:9000 -p 9001:9001 \
    minio/minio server /data --console-address ":9001" >/dev/null
until curl -sf -o /dev/null http://127.0.0.1:9000/minio/health/live; do sleep 1; done

if [ -z "$RUN_ABS" ]; then
echo "[2/4] creating the bucket (no run given; upload one from the browser)"
docker run --rm -i --network "$NET" \
    -e AWS_ACCESS_KEY_ID="$KEY" -e AWS_SECRET_ACCESS_KEY="$SECRET" \
    -e RUN_NAME="" "$IMAGE" \
    "${VIRTUAL_ENV:-/opt/conda/envs/tethys}/bin/python" -c "
import boto3
s3 = boto3.client('s3', endpoint_url='http://ngiab-minio:9000', region_name='us-east-1')
if 'portal-media' not in [b['Name'] for b in s3.list_buckets()['Buckets']]:
    s3.create_bucket(Bucket='portal-media')
print('      bucket ready')
"
else
echo "[2/4] uploading $RUN_NAME to s3://$BUCKET/ngiab_visualizer/"
docker run --rm -i --network "$NET" -v "$RUN_ABS:/src:ro" \
    -e AWS_ACCESS_KEY_ID="$KEY" -e AWS_SECRET_ACCESS_KEY="$SECRET" \
    -e RUN_NAME="$RUN_NAME" "$IMAGE" \
    "${VIRTUAL_ENV:-/opt/conda/envs/tethys}/bin/python" - <<'PY'
import boto3, os
s3 = boto3.client("s3", endpoint_url="http://ngiab-minio:9000", region_name="us-east-1")
existing = [b["Name"] for b in s3.list_buckets()["Buckets"]]
if "portal-media" not in existing:
    s3.create_bucket(Bucket="portal-media")
count = 0
for root, _, files in os.walk("/src"):
    for name in files:
        path = os.path.join(root, name)
        key = f"ngiab_visualizer/{os.environ['RUN_NAME']}/{os.path.relpath(path, '/src')}"
        s3.upload_file(path, "portal-media", key)
        count += 1
print(f"      {count} objects")
PY
fi

echo "[3/4] starting the portal on :$PORT"
docker run -d --name "$APP" --network "$NET" -p "$PORT:$PORT" \
    -e PORT="$PORT" \
    -e NGIAB_STORAGE_BACKEND=s3 \
    -e NGIAB_S3_BUCKET="$BUCKET" \
    -e NGIAB_S3_ENDPOINT="http://$MINIO:9000" \
    -e NGIAB_S3_PUBLIC_ENDPOINT="http://127.0.0.1:9000" \
    -e AWS_ACCESS_KEY_ID="$KEY" \
    -e AWS_SECRET_ACCESS_KEY="$SECRET" \
    -e AWS_DEFAULT_REGION=us-east-1 \
    -e PORTAL_ALLOWED_HOSTS="localhost,127.0.0.1" \
    -e PORTAL_SUPERUSER_NAME=admin \
    -e PORTAL_SUPERUSER_PASSWORD=localdev \
    -e TETHYS_SECRET_KEY=local-rehearsal-not-a-shared-deployment \
    "$IMAGE" >/dev/null

echo "[4/4] waiting for it to answer"
for _ in $(seq 1 60); do
    sleep 3
    if curl -sf -o /dev/null "http://127.0.0.1:$PORT/"; then break; fi
done

echo
echo "portal   http://127.0.0.1:$PORT/       (admin / localdev)"
echo "minio    http://127.0.0.1:9001/        ($KEY / $SECRET)"
echo "runs     $(curl -s "http://127.0.0.1:$PORT/getModelRuns/")"
echo
echo "Sign in as admin, then use the upload panel under the run picker."
echo
echo "The delete button appears only after signing in as admin."
echo "Logs:  docker logs -f $APP"
echo "Down:  scripts/try-object-storage.sh --down"
