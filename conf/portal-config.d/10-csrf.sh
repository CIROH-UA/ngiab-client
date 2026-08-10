#!/usr/bin/env bash
#
# Inject CSRF_TRUSTED_ORIGINS into the rendered portal config.
#
# Replaces the PATCH_Portal_Settings_TethysCore state in salt/patches.sls, which ran
# `tethys settings --set CSRF_TRUSTED_ORIGINS` at container start. The value cannot be
# baked into the image: it depends on the host port viewOnTethys.sh picks and on the host's
# own IP addresses, both known only at launch.
#
# Without this, logging in fails with "CSRF verification failed. Request aborted." on any
# origin other than the one Django infers.
#
# Sourced by portal-config.sh in both the provision and web containers. Must be idempotent.

# viewOnTethys.sh exports this as a JSON-ish list, e.g.
#   ["http://localhost:8080","http://127.0.0.1:8080"]
if [ -n "${CSRF_TRUSTED_ORIGINS:-}" ]; then
    export CSRF_TRUSTED_ORIGINS
    echo "[portal-config] CSRF_TRUSTED_ORIGINS=${CSRF_TRUSTED_ORIGINS}"
else
    echo "[portal-config] CSRF_TRUSTED_ORIGINS unset; only the inferred origin will be trusted"
fi
