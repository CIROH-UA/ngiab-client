# NGIAB Visualizer image, built on tethys-uvx.
#
# Replaced the conda/pdm/nginx/salt image, whose Dockerfile, run.sh, and salt/ states were
# removed once this was verified end to end. (The Singularity build under singularity/ is
# unrelated and keeps its own salt states.)
#
#   - Base is ghcr.io/aquaveo/tethys-uvx: debian-slim + uv, no conda, no nginx, no salt,
#     no supervisor. VIRTUAL_ENV is still /opt/conda/envs/tethys upstream, so bind-mount
#     dev workflows against site-packages keep working.
#   - Node/npm and the webpack build are gone: the frontend is build-less vanilla JS
#     served straight from tethysapp/ngiab/public/frontend/.
#   - The gcc/g++/python3-dev install-and-purge step is gone; it existed because pdm
#     resolved the numpy sdist over the manylinux wheel, which uv does not.
#   - THE DATABASE AND STATIC FILES ARE BAKED AT BUILD TIME. See below.
#
# Why bake the database: viewOnTethys.sh runs the container with --rm and bind-mounts only
# subpaths of TETHYS_PERSIST, so the persist root is an anonymous volume discarded on exit.
# Portal state (migrations, superuser, app registration) is therefore already rebuilt from
# scratch on every launch. Baking it produces exactly the same state without paying for it
# on every start, and lets the container use the upstream serve.sh CMD unchanged -- no
# provisioning at container start at all.
#
# Both artifacts live under /opt/ngiab, deliberately OUTSIDE ${TETHYS_PERSIST}: that path
# is a declared VOLUME in the base image, and anything written into a volume path can be
# masked by a user's own bind mount.
#
# ---------------------------------------------------------------------------
# INVARIANT: THE CONTAINER MUST NEVER NEED ROOT AT RUN TIME.
#
# It runs as the base image's unprivileged `tethys` user (uid 1000) and must stay that way
# -- rootless Podman is a supported deployment. That holds only because every path the app
# writes is chowned to 1000:1000 at BUILD time (build-time root is fine; run-time root is
# not):
#
#   /opt/ngiab/tethys_platform.sqlite   Django writes sessions here
#   /opt/ngiab/static                   collectstatic output
#
# ${TETHYS_PERSIST} is root-owned and read-only to the app, which is harmless precisely
# because nothing the app writes lives there any more. The conda image had to `chown` the
# sqlite DB in run.sh on every start, which forced the container to begin life as root.
#
# So: do NOT move STATIC_ROOT or the database back under ${TETHYS_PERSIST}, and do NOT add
# a runtime chown. Either change reintroduces the need for root.
# ---------------------------------------------------------------------------
#
# Upstream publishes only commit tags, so pin one and bump deliberately.

ARG TETHYS_UVX_TAG=a3148d5

# ---------------------------------------------------------------------------
# Build: install the app, then provision the SQLite DB and collect static
# ---------------------------------------------------------------------------
FROM ghcr.io/aquaveo/tethys-uvx:builder-${TETHYS_UVX_TAG} AS builder

WORKDIR /build
COPY . /build

# setuptools-scm derives the version from git metadata, so .git must be present in the
# build context (.dockerignore deliberately does not exclude it) and trusted here.
RUN git config --global --add safe.directory '*' \
    && uv pip install --python "${VIRTUAL_ENV}" /build

# Pre-install the DuckDB extensions the TEEHR reader needs. Without this, runtime LOAD
# reaches out to extensions.duckdb.org and fails on any restricted-egress deployment.
# Building them in also pins the extensions to the pinned DuckDB version.
#
# `avro` is required in addition to sqlite + iceberg: as of DuckDB 1.5.5 the iceberg
# extension's init function auto-installs avro on first use, which fails here because this
# directory is deliberately read-only at run time:
#   Initialization function "iceberg_duckdb_cpp_init" ... threw an exception:
#   "An error occurred while trying to automatically install the required extension 'avro'"
# The conda image pinned 1.5.2, where iceberg did not pull avro in — so this surfaced only
# after uv resolved a newer patch inside the same >=1.5,<1.6 range.
ENV DUCKDB_HOME=/opt/duckdb_extensions
RUN mkdir -p "${DUCKDB_HOME}" \
    && "${VIRTUAL_ENV}/bin/python" -c "\
import duckdb, os; \
h = os.environ['DUCKDB_HOME']; \
c = duckdb.connect(); \
c.execute(f\"SET home_directory='{h}'\"); \
c.execute(f\"SET extension_directory='{h}'\"); \
c.execute('INSTALL sqlite'); \
c.execute('INSTALL iceberg'); \
c.execute('INSTALL avro'); \
print('duckdb extensions installed:', duckdb.__version__)" \
    && chmod -R a+rX "${DUCKDB_HOME}"

# Provision. These are the same steps provision.sh performs at deploy time, run here
# instead because SQLite is a file and every input is known at build time.
ENV TETHYS_DB_ENGINE=django.db.backends.sqlite3
ENV TETHYS_DB_NAME=/opt/ngiab/tethys_platform.sqlite
ENV STATIC_ROOT=/opt/ngiab/static
ENV PORTAL_SUPERUSER_NAME=admin
ENV PORTAL_SUPERUSER_PASSWORD=pass

# tethys reads ${TETHYS_HOME}/portal_config.yml. At run time serve.sh regenerates it from
# /config via portal-config.sh (merging launch-time ALLOWED_HOSTS / CSRF origins); here we
# place the same file directly so the build-time commands see identical settings.
COPY conf/portal_config.yml ${TETHYS_HOME}/portal_config.yml

# Single-app mode is commented out for the migrate and restored straight after. Tethys
# resolves STANDALONE_APP while importing the URLConf, which Django loads for the system
# checks that run before migrate -- so it queries tethys_apps_tethysapp on a database where
# that table does not exist yet. Upstream guards this with `except ProgrammingError`, which
# is what psycopg raises for a missing table; sqlite raises OperationalError and sails
# straight through. Everything after the migrate sees the real single-app settings, and the
# baked database carries the app row, so the runtime lookup succeeds.
RUN mkdir -p /opt/ngiab/static \
    && sed -i -E 's/^([[:space:]]*)(MULTIPLE_APP_MODE|STANDALONE_APP):/\1# BUILD-DISABLED \2:/' \
        "${TETHYS_HOME}/portal_config.yml" \
    && "${VIRTUAL_ENV}/bin/tethys" db migrate \
    && "${VIRTUAL_ENV}/bin/tethys" db createsuperuser \
        --pn "${PORTAL_SUPERUSER_NAME}" \
        --pp "${PORTAL_SUPERUSER_PASSWORD}" \
        --pe "" \
    && sed -i -E 's/^([[:space:]]*)# BUILD-DISABLED (MULTIPLE_APP_MODE|STANDALONE_APP):/\1\2:/' \
        "${TETHYS_HOME}/portal_config.yml" \
    && grep -q '^[[:space:]]*MULTIPLE_APP_MODE:' "${TETHYS_HOME}/portal_config.yml" \
    && "${VIRTUAL_ENV}/bin/tethys" site -f \
    && "${VIRTUAL_ENV}/bin/tethys" manage collectstatic --noinput \
    && chown -R 1000:1000 /opt/ngiab \
    # Fail the build rather than ship an image whose DB silently landed elsewhere:
    # the settings module ignores TETHYS_DB_NAME, so the DATABASES block in
    # portal_config.yml is what actually places this file.
    && test -s /opt/ngiab/tethys_platform.sqlite \
    && echo "baked db: $(stat -c%s /opt/ngiab/tethys_platform.sqlite) bytes" \
    && echo "baked static: $(find /opt/ngiab/static -type f | wc -l) files"

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM ghcr.io/aquaveo/tethys-uvx:runtime-base-${TETHYS_UVX_TAG}

COPY --from=builder /opt/python /opt/python
COPY --from=builder /opt/conda /opt/conda
COPY --from=builder /opt/duckdb_extensions /opt/duckdb_extensions
COPY --from=builder --chown=1000:1000 /opt/ngiab /opt/ngiab

COPY --chown=1000:1000 conf/portal_config.yml /config/portal_config.yml
COPY --chown=1000:1000 conf/portal-config.d/ /opt/portal/portal-config.d/
COPY --chmod=0755 scripts/ngiab-seed-db.sh /usr/local/bin/ngiab-seed-db.sh
COPY --chmod=0755 scripts/ngiab-entrypoint.sh /usr/local/bin/ngiab-entrypoint.sh
COPY --chmod=0755 scripts/ngiab-register.sh /usr/local/bin/ngiab-register.sh
COPY --chmod=0755 scripts/ngiab-convert.sh /usr/local/bin/ngiab-convert.sh

# SQLite, not Postgres: the visualizer ships as a single self-contained container.
# Both paths are outside ${TETHYS_PERSIST} so a user bind mount cannot mask them.
ENV TETHYS_DB_ENGINE=django.db.backends.sqlite3
ENV TETHYS_DB_NAME=/opt/ngiab/tethys_platform.sqlite
ENV STATIC_ROOT=/opt/ngiab/static
ENV TETHYS_PERSIST=/var/lib/tethys_persist

# 8080 keeps viewOnTethys.sh's CONTAINER_PORT contract intact (and is rootless-Podman safe).
ENV PORT=8080
ENV TETHYS_PORT=8080

# Deliberate, and carried over from the conda image: the visualizer is a local single-user
# tool with no network exposure by default, and a known default login is what makes
# viewOnTethys.sh a one-command experience. This trips the SecretsUsedInArgOrEnv build
# check. Override both at run time for any shared deployment -- but note the baked DB
# already contains this superuser, so changing the env alone will not change the password.
ENV PORTAL_SUPERUSER_NAME=admin
ENV PORTAL_SUPERUSER_PASSWORD=pass

ENV DUCKDB_HOME=/opt/duckdb_extensions

# portal-config.sh hard-requires TETHYS_SECRET_KEY and reads it only from the environment
# -- there is no file/secret-mount fallback -- so without a default the container refuses
# to start. This placeholder keeps a bare `docker run` working; viewOnTethys.sh overrides
# it with a freshly generated value per launch. Sessions are ephemeral (the container runs
# with --rm), so a per-launch key costs nothing. OVERRIDE for any shared deployment.
ENV TETHYS_SECRET_KEY=ngiab-local-default-override-in-any-shared-deployment

# The old image patched nginx with 600s proxy timeouts because TEEHR/DuckDB queries are
# slow. There is no nginx now: uvicorn (the default) imposes no request timeout, so the
# concern is moot there. This only matters under SERVER=gunicorn, whose 60s default would
# kill a long warehouse query mid-flight.
ENV GUNICORN_TIMEOUT=600
ENV GUNICORN_GRACEFUL_TIMEOUT=60

# Where the model-run registry actually lives when a writable volume is mounted. The
# entrypoint seeds the baked database here on first start and symlinks the image path at it;
# without the mount the container still runs, just without persistence.
ENV NGIAB_DB_PATH=/var/lib/tethys_persist/db/portal.sqlite

# Provisioning still happens at build time -- this wrapper only seeds the database onto the
# host mount, then execs the base's serve.sh. It needs no privileges (see the script).
CMD ["/usr/local/bin/ngiab-entrypoint.sh"]
