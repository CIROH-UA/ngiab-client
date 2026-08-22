#!/usr/bin/env bash
#
# Serving entrypoint: seed the database onto the host mount, bring it up to date, then serve.
#
# Provisioning happened at build time, but the build's database is only the starting point:
# once a user has a seeded copy on a mount, ngiab_seed_db leaves it alone, so a migration
# added in a later image would never reach it. Migrating here closes that gap -- without it
# the first schema change after release breaks every existing install, silently, because the
# app reads a table that no longer matches the model.
#
# Idempotent and quick when there is nothing to apply. Needs no privileges -- see
# ngiab-seed-db.sh.

set -euo pipefail

# shellcheck source=/dev/null
. /usr/local/bin/ngiab-seed-db.sh
ngiab_seed_db

# DATABASES lives in portal_config.yml, which serve.sh renders; migrate needs it first.
/usr/local/bin/portal-config.sh

# Resolved once and used for everything below. Not `tethys manage`: that wrapper prints a
# failing command's error and still exits 0 -- measured, the same command exits 1 through
# manage.py and 0 through the wrapper. Every step here is one whose failure has to stop the
# container, so none of them can go through it.
NGIAB_MANAGE_PY="$("${VIRTUAL_ENV:-/opt/conda/envs/tethys}/bin/tethys" manage path | tail -1)"
test -f "${NGIAB_MANAGE_PY}" || {
    echo "[ngiab] could not locate manage.py; refusing to start unchecked" >&2
    exit 1
}
ngiab_manage() {
    "${VIRTUAL_ENV:-/opt/conda/envs/tethys}/bin/python" "${NGIAB_MANAGE_PY}" "$@"
}

# Before migrate, because the migration that drops the run registry is what this rescues the
# rows from. Idempotent, so a start with nothing to do costs a table lookup.
echo "[ngiab] backfilling run manifests"
ngiab_manage backfill_manifests

echo "[ngiab] applying any migrations this image adds"
"${VIRTUAL_ENV:-/opt/conda/envs/tethys}/bin/tethys" db migrate

# After migrate, because it writes a user, and before serve, because it can refuse to serve.
# A hosted deployment running on the image's baked admin/pass -- which is public, and which an
# ephemeral database restores on every restart -- stops here rather than starting.
echo "[ngiab] checking deployment credentials"
ngiab_manage ensure_superuser

exec /usr/local/bin/serve.sh
