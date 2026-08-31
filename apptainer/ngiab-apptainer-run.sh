#!/usr/bin/env bash
#
# Apptainer entrypoint. Same server, same config, same baked database as the container
# image; only the parts that assume a writable image are different.
#
# Apptainer differs from Podman in two ways that matter here:
#
#   1. The image is READ-ONLY at run time. Every path the portal writes -- the database, the
#      rendered config, media, workspaces, and the directory of model runs -- therefore has
#      to be moved off the image and onto the host before the server starts.
#
#   2. It runs as the INVOKING user, not uid 1000. Nothing may depend on owning a path
#      inside the image.
#
# The state directory defaults to ~/.ngiab_visualizer. Override with NGIAB_STATE_DIR.

set -euo pipefail

state="${NGIAB_STATE_DIR:-${HOME:-/tmp}/.ngiab_visualizer}"
baked="${NGIAB_BAKED_DB:-/home/tethys/ngiab/tethys_platform.sqlite}"

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
# writable. STATIC_ROOT stays in the image: collectstatic already ran at build time, and
# /home/tethys/ngiab is read-only here, which is all static needs. Note TETHYS_PERSIST moves
# to the host while the baked artefacts keep the image path -- writes go out, reads stay in.
export TETHYS_HOME="$state/portal"
export TETHYS_PERSIST="$state"
export MEDIA_ROOT="$state/media"
export TETHYS_WORKSPACES_ROOT="$state/workspaces"
export STATIC_ROOT="${STATIC_ROOT:-/home/tethys/ngiab/static}"

# The directory of run directories IS the registry, and the app derives it from
# TETHYS_PERSIST, which is already the state directory above -- so it follows onto the host
# with no second setting to keep in step. NGIAB_MANAGED_ROOT still overrides it: point that
# at a bound directory of existing runs to read them in place. Read-only is enough to list
# and view; only uploading needs write, which is why this mkdir is not fatal.
runs="${NGIAB_MANAGED_ROOT:-$state/ngiab_visualizer}"
mkdir -p "$runs" 2>/dev/null \
    || echo "[ngiab] warning: $runs is not writable; runs there can be listed but not uploaded" >&2

# portal-config.sh reads this from the environment only and refuses to start without it.
# Ephemeral by design: a SIF has no per-install secret to inherit.
if [ -z "${TETHYS_SECRET_KEY:-}" ]; then
    export TETHYS_SECRET_KEY="ngiab-apptainer-$(head -c 32 /dev/urandom | base64 | tr -d '=+/')"
fi

# The state database outlives the image it was seeded from, and this is the only shipped
# deployment where that is true -- serve.sh does not migrate, so without this a SIF carrying
# newer platform migrations would start against the previous schema and fail at the first
# query that needs a new column. Migrate is a no-op on a current database.
# Quiet when it works, and never quiet when it does not: a schema that failed to migrate is
# the thing you want to read about, so the output is held and printed only on failure.
migrate_log="$state/db/migrate.log"
if ! "${VIRTUAL_ENV:-/opt/conda/envs/tethys}/bin/tethys" db migrate >"$migrate_log" 2>&1; then
    echo "[ngiab] warning: could not migrate $live; continuing with the schema it has" >&2
    echo "[ngiab] what migrate said:" >&2
    tail -n 40 "$migrate_log" >&2
fi

echo "[ngiab] state directory: $state"
echo "[ngiab] database: $live"
echo "[ngiab] model runs: $runs"
echo "[ngiab] serving on port ${PORT:-8080}"

exec /usr/local/bin/serve.sh
