#!/usr/bin/env bash
#
# One-shot entrypoint for converting a run's outputs to parquet.
#
# Same shape as ngiab-register.sh: the launcher has no Python of its own. No database is
# involved, so this skips the seed -- but portal-config.sh still has to run, because Django
# refuses to start without a rendered configuration.

set -euo pipefail

/usr/local/bin/portal-config.sh

exec /opt/conda/envs/tethys/bin/tethys manage convert_outputs "$@"
