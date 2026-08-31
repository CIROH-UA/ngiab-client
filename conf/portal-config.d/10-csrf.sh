#!/usr/bin/env bash
#
# Set CSRF_TRUSTED_ORIGINS for local HTTP access.
#
# Replaces the PATCH_Portal_Settings_TethysCore state in salt/patches.sls, and works the
# same way: by calling `tethys settings` directly.
#
# Two reasons this cannot be done by exporting a variable, and one why it cannot be
# written into conf/portal_config.yml either:
#
#   1. portal-config.sh reads only PORTAL_ALLOWED_HOSTS and TETHYS_DEBUG from the
#      environment. CSRF_TRUSTED_ORIGINS is not among them, so exporting it reaches
#      nothing. This hook runs after the settings are rendered and applies it with
#      `tethys settings --set`, which is why the late ordering is what makes it work.
#   2. portal-config.sh derives CSRF_TRUSTED_ORIGINS from ALLOWED_HOSTS but deliberately
#      skips localhost, 127.0.0.1, and bare IPs (it only auto-trusts https:// hostnames).
#      The visualizer is served over plain http on localhost, so the derived list is empty
#      and every login fails with "CSRF verification failed. Request aborted."
#   3. A value in portal_config.yml does survive -- portal-config.sh seeds its list from
#      whatever is already there -- but it cannot express this one. The origins carry the
#      port the user picks at launch and every IPv4 the host owns, including the WSL and
#      LAN addresses, and neither is known when that file is written.
#
# viewOnTethys.sh exports the value as a YAML/JSON list, e.g.
#   ["http://localhost:8080","http://127.0.0.1:8080"]
#
# Runs in both the provision and web containers. Idempotent: setting the same value twice
# is a no-op.

if [ -n "${CSRF_TRUSTED_ORIGINS:-}" ]; then
    echo "[portal-config] setting CSRF_TRUSTED_ORIGINS=${CSRF_TRUSTED_ORIGINS}"
    tethys settings --set CSRF_TRUSTED_ORIGINS "${CSRF_TRUSTED_ORIGINS}"
else
    echo "[portal-config] CSRF_TRUSTED_ORIGINS unset; logins over plain http will fail" >&2
fi
