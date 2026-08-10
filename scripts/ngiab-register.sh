#!/usr/bin/env bash
#
# One-shot entrypoint for registering a model run from viewOnTethys.sh.
#
# The launcher has no Python environment of its own, so it runs this in a throwaway
# container with the same database mount the serving container uses. Seeding first is what
# makes the row land in the persistent database rather than the image's baked copy -- which
# would be discarded the moment this container exits.
#
# Arguments are passed straight through to the management command, e.g.
#   ngiab-register.sh --path /var/lib/tethys_persist/ngiab_visualizer/run --label run

set -euo pipefail

# shellcheck source=/dev/null
. /usr/local/bin/ngiab-seed-db.sh
ngiab_seed_db

# Render portal_config.yml into TETHYS_HOME. serve.sh does this on the serving path; without
# it Django never sees our DATABASES block and silently falls back to its default sqlite
# path -- a brand-new empty file, which fails with "no such table" rather than anything that
# points at the real cause.
/usr/local/bin/portal-config.sh

exec /opt/conda/envs/tethys/bin/tethys manage register_run "$@"
