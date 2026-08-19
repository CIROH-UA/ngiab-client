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

echo "[ngiab] applying any migrations this image adds"
"${VIRTUAL_ENV:-/opt/conda/envs/tethys}/bin/tethys" db migrate

exec /usr/local/bin/serve.sh
