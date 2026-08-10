#!/usr/bin/env bash
#
# Seed the portal database onto a host mount. Sourced by both entrypoints.
#
# The database is baked into the image at build time, which makes startup fast but ties its
# lifetime to the container -- and viewOnTethys.sh runs with --rm. That was fine while the
# database held only migrations and a superuser. It is not fine now that it owns the
# model-run registry, which users expect to survive a restart.
#
# If a writable database directory is mounted, copy the baked database there once and point
# the image's path at it with a symlink. SQLite follows the symlink and creates its
# -wal/-journal siblings next to the real file, on the host.
#
# Why a symlink rather than reconfiguring DATABASES at startup: the path is declared in
# portal_config.yml, which the build also uses. Rewriting it at runtime would make the build
# and the runtime disagree about where the database lives.
#
# NOTHING HERE NEEDS ROOT. It copies a file the runtime user already owns into a directory
# the runtime user can already write, or does nothing at all. Without the mount the
# container still starts on the image's ephemeral database, so a bare `docker run` keeps
# working -- it just does not persist.

ngiab_seed_db() {
    local baked="${NGIAB_BAKED_DB:-/opt/ngiab/tethys_platform.sqlite}"
    local live="${NGIAB_DB_PATH:-/var/lib/tethys_persist/db/portal.sqlite}"
    local live_dir
    live_dir="$(dirname "$live")"

    if [ ! -d "$live_dir" ] || [ ! -w "$live_dir" ]; then
        echo "[ngiab] $live_dir is not a writable mount; using the image's ephemeral database."
        echo "[ngiab] Model runs registered in this container will not survive it."
        return 0
    fi

    if [ ! -f "$live" ]; then
        echo "[ngiab] seeding the database to $live"
        cp "$baked" "$live"
    fi

    # Guarded so a container restart -- where the symlink already exists -- does not clobber
    # the live database with the baked template. Removing the target instead of the link
    # would lose every registered run.
    if [ ! -L "$baked" ]; then
        rm -f "$baked"
        ln -s "$live" "$baked"
    fi
}
