#!/usr/bin/env bash
#
# Apptainer entrypoint. Same server, same config, same baked database as the container
# image; only the parts that assume a writable image are different.
#
# Apptainer differs from Podman in two ways that matter here:
#
#   1. The image is READ-ONLY at run time. The Docker entrypoint seeds the database onto a
#      host mount and symlinks the image path at it -- that symlink is a write into /opt,
#      which fails here. Instead the live database path is written into a generated
#      portal_config.yml and handed to portal-config.sh via PORTAL_CONFIG_SRC, which it
#      already honours.
#
#   2. It runs as the INVOKING user, not uid 1000. Nothing may depend on owning a path
#      inside the image, so every writable path lives under a state directory on the host.
#
# The state directory defaults to ~/.ngiab_visualizer. Override with NGIAB_STATE_DIR.

set -euo pipefail

state="${NGIAB_STATE_DIR:-${HOME:-/tmp}/.ngiab_visualizer}"
baked="${NGIAB_BAKED_DB:-/opt/ngiab/tethys_platform.sqlite}"

mkdir -p "$state/portal" "$state/db" "$state/media" "$state/workspaces"

if [ ! -w "$state" ]; then
    echo "[ngiab] $state is not writable. Set NGIAB_STATE_DIR to a writable path." >&2
    exit 1
fi

live="$state/db/portal.sqlite"
if [ ! -f "$live" ]; then
    echo "[ngiab] seeding the database to $live"
    cp "$baked" "$live"
    chmod u+w "$live"
fi

# portal-config.sh derives DATABASES.default.NAME from TETHYS_DB_NAME (via db-env.sh) and
# writes it into the rendered config, so pointing that at the live copy is all it takes.
# Rewriting the yaml here instead would be undone by that same step.
export TETHYS_DB_NAME="$live"

# portal-config.sh copies this into TETHYS_HOME and rewrites it there, so both must be
# writable. STATIC_ROOT stays in the image: collectstatic already ran at build time.
export TETHYS_HOME="$state/portal"
export TETHYS_PERSIST="$state"
export MEDIA_ROOT="$state/media"
export TETHYS_WORKSPACES_ROOT="$state/workspaces"
export STATIC_ROOT="${STATIC_ROOT:-/opt/ngiab/static}"

# portal-config.sh reads this from the environment only and refuses to start without it.
# Ephemeral by design: a SIF has no per-install secret to inherit.
if [ -z "${TETHYS_SECRET_KEY:-}" ]; then
    export TETHYS_SECRET_KEY="ngiab-apptainer-$(head -c 32 /dev/urandom | base64 | tr -d '=+/')"
fi

echo "[ngiab] state directory: $state"
echo "[ngiab] database: $live"
echo "[ngiab] serving on port ${PORT:-8080}"

exec /usr/local/bin/serve.sh
