#!/usr/bin/env bash
#
# One-shot entrypoint for preparing a run: consolidating its outputs to parquet and writing
# the manifest that makes it a registered run.
#
# portal-config.sh has to run first, because Django refuses to start without a rendered
# configuration -- and because a command that skips it makes Django fall back to its default
# SQLite path and fail with `no such table`, an error that points nowhere near the cause.
#
# That is the part that does not work unchanged in a SIF. portal-config.sh copies the config
# into TETHYS_HOME and rewrites it there, and an Apptainer image is read-only, so this used
# to die with "cannot create regular file '/home/tethys/portal/portal_config.yml':
# Read-only file system" -- which after the manifest change meant an Apptainer deployment
# could not prepare a run at all. When TETHYS_HOME is not writable this redirects it, along
# with the database Tethys writes to during app harvesting, into a temporary directory that
# is discarded afterwards. Preparing a run needs no persistent portal state.
#
# Docker and Podman are unaffected: their TETHYS_HOME is writable and the branch is skipped.

set -euo pipefail

VENV="${VIRTUAL_ENV:-/opt/conda/envs/tethys}"
scratch=""

cleanup() {
    [ -n "$scratch" ] && rm -rf "$scratch"
}
trap cleanup EXIT

if [ ! -w "${TETHYS_HOME:-/home/tethys/portal}" ]; then
    scratch="$(mktemp -d "${TMPDIR:-/tmp}/ngiab-prepare.XXXXXX")"
    mkdir -p "$scratch/portal" "$scratch/db"

    # Harvesting writes to the database on any command that is not `migrate`, so a read-only
    # baked copy is not enough.
    cp "${NGIAB_BAKED_DB:-/opt/ngiab/tethys_platform.sqlite}" "$scratch/db/portal.sqlite"
    chmod u+w "$scratch/db/portal.sqlite"

    export TETHYS_HOME="$scratch/portal"
    export TETHYS_DB_NAME="$scratch/db/portal.sqlite"
    export TETHYS_PERSIST="$scratch"

    # portal-config.sh reads this from the environment only and refuses to start without it.
    # Ephemeral by design: nothing here outlives the command.
    if [ -z "${TETHYS_SECRET_KEY:-}" ]; then
        export TETHYS_SECRET_KEY="ngiab-prepare-$(head -c 32 /dev/urandom | base64 | tr -d '=+/')"
    fi
fi

/usr/local/bin/portal-config.sh

# manage.py rather than `tethys manage`: the wrapper prints a failing command's error and
# still exits 0, so a failed conversion would look like a successful one to the launcher.
MANAGE_PY="$("${VENV}/bin/tethys" manage path | tail -1)"
test -f "${MANAGE_PY}" || {
    echo "[ngiab] could not locate manage.py" >&2
    exit 1
}
"${VENV}/bin/python" "${MANAGE_PY}" convert_outputs "$@"
