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
#     scripts/try-object-storage.sh <prepared-run-directory> [port]
#
# The run directory must already have a manifest -- prepare one with:
#     docker run --rm -v "$PWD/myrun:/run" <image> /usr/local/bin/ngiab-convert.sh --path /run
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
if [ -z "$RUN_DIR" ] || [ ! -d "$RUN_DIR" ]; then
    echo "usage: $0 <prepared-run-directory> [port]" >&2
    exit 1
fi
if [ ! -f "$RUN_DIR/manifest.json" ]; then
    echo "error: $RUN_DIR has no manifest.json -- convert it first (see the header)" >&2
    exit 1
fi
RUN_NAME="$(basename "$(cd "$RUN_DIR" && pwd)")"

trap 'echo; echo "(leaving containers up; scripts/try-object-storage.sh --down to remove)"' INT

down >/dev/null 2>&1 || true
docker network create "$NET" >/dev/null

echo "[1/4] starting minio"
docker run -d --name "$MINIO" --network "$NET" \
    -e MINIO_ROOT_USER="$KEY" -e MINIO_ROOT_PASSWORD="$SECRET" \
    -p 9000:9000 -p 9001:9001 \
    minio/minio server /data --console-address ":9001" >/dev/null
until curl -sf -o /dev/null http://127.0.0.1:9000/minio/health/live; do sleep 1; done

echo "[2/4] uploading $RUN_NAME to s3://$BUCKET/ngiab_visualizer/"
docker run --rm -i --network "$NET" -v "$(cd "$RUN_DIR" && pwd):/src:ro" \
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

echo "[3/4] starting the portal on :$PORT"
docker run -d --name "$APP" --network "$NET" -p "$PORT:$PORT" \
    -e PORT="$PORT" \
    -e NGIAB_STORAGE_BACKEND=s3 \
    -e NGIAB_S3_BUCKET="$BUCKET" \
    -e NGIAB_S3_ENDPOINT="http://$MINIO:9000" \
    -e AWS_ACCESS_KEY_ID="$KEY" \
    -e AWS_SECRET_ACCESS_KEY="$SECRET" \
    -e AWS_DEFAULT_REGION=us-east-1 \
    -e PORTAL_ALLOWED_HOSTS="localhost,127.0.0.1" \
    -e CSRF_TRUSTED_ORIGINS="[\"http://localhost:$PORT\",\"http://127.0.0.1:$PORT\"]" \
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
echo "The delete button appears only after signing in as admin."
echo "Logs:  docker logs -f $APP"
echo "Down:  scripts/try-object-storage.sh --down"
