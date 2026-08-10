#!/usr/bin/env bash
#
# Serving entrypoint: seed the database onto the host mount, then serve.
#
# Provisioning (migrations, superuser, static) already happened at build time, so this only
# handles the one thing that cannot: pointing the app at a database that outlives the
# container. Needs no privileges -- see ngiab-seed-db.sh.

set -euo pipefail

# shellcheck source=/dev/null
. /usr/local/bin/ngiab-seed-db.sh
ngiab_seed_db

exec /usr/local/bin/serve.sh
