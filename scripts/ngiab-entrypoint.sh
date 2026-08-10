#!/usr/bin/env bash
#
# NGIAB visualizer entrypoint: provision, then serve, in one container.
#
# tethys-uvx separates these deliberately -- provision.sh is meant to run as a pipeline
# step or Kubernetes init container, so the web container only ever serves. That split is
# right for a hosted portal. The visualizer is not one: it ships as a single `docker run`
# that an end user launches from viewOnTethys.sh and opens in a browser. There is no
# pipeline to hang provisioning off, so we run it here.
#
# This is safe because provision.sh is documented as idempotent -- migrations, superuser
# creation, and static publishing all no-op when already done.

set -euo pipefail

echo "[ngiab] provisioning (migrations, superuser, static)..."
if ! /usr/local/bin/provision.sh; then
    echo "[ngiab] provision.sh failed -- refusing to start the server." >&2
    echo "[ngiab] The most common causes are an unwritable ${TETHYS_PERSIST:-persist}" >&2
    echo "[ngiab] volume or a corrupt sqlite database." >&2
    exit 1
fi

echo "[ngiab] provisioning complete; starting server on port ${PORT:-${TETHYS_PORT:-8000}}"
exec /usr/local/bin/serve.sh
