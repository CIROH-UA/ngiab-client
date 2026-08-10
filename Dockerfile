# NGIAB Visualizer image, built on tethys-uvx.
#
# Replaces the conda/pdm/nginx/salt image (kept as Dockerfile.conda for reference until
# this is proven). What changed and why:
#
#   - Base is ghcr.io/aquaveo/tethys-uvx: debian-slim + uv, no conda, no nginx, no salt,
#     no supervisor. VIRTUAL_ENV is still /opt/conda/envs/tethys for compatibility, so
#     bind-mount dev workflows against site-packages keep working.
#   - Node/npm and the webpack build are gone. The frontend is build-less vanilla JS
#     served straight out of tethysapp/ngiab/public/frontend/.
#   - The gcc/g++/python3-dev install-and-purge dance is gone: it existed because pdm
#     resolved the numpy sdist over the manylinux wheel. uv resolves wheels.
#   - Provisioning (migrate, superuser, collectstatic) moves into provision.sh, invoked
#     once by the entrypoint rather than on every request path.
#
# Upstream publishes only commit tags, so pin one and bump deliberately.

ARG TETHYS_UVX_TAG=a3148d5

# ---------------------------------------------------------------------------
# Build: install the app into the framework venv
# ---------------------------------------------------------------------------
FROM ghcr.io/aquaveo/tethys-uvx:builder-${TETHYS_UVX_TAG} AS builder

WORKDIR /build
COPY . /build

# setuptools-scm derives the version from git metadata, so .git must be present in the
# build context (.dockerignore deliberately does not exclude it) and trusted here.
RUN git config --global --add safe.directory '*' \
    && uv pip install --python "${VIRTUAL_ENV}" /build

# Pre-install the DuckDB extensions the TEEHR reader needs (sqlite_scanner + iceberg).
# Without this, runtime LOAD reaches out to extensions.duckdb.org and fails on any
# restricted-egress deployment. Installing at build time also pins the extension to the
# pinned DuckDB version. World-readable so the unprivileged runtime user can LOAD it.
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
print('duckdb extensions installed:', duckdb.__version__)" \
    && chmod -R a+rX "${DUCKDB_HOME}"

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM ghcr.io/aquaveo/tethys-uvx:runtime-base-${TETHYS_UVX_TAG}

COPY --from=builder /opt/python /opt/python
COPY --from=builder /opt/conda /opt/conda
COPY --from=builder /opt/duckdb_extensions /opt/duckdb_extensions

COPY --chown=1000:1000 conf/portal_config.yml /config/portal_config.yml
COPY --chown=1000:1000 conf/portal-config.d/ /opt/portal/portal-config.d/
COPY --chmod=0755 scripts/ngiab-entrypoint.sh /usr/local/bin/ngiab-entrypoint.sh

# SQLite, not Postgres: the visualizer ships as a single self-contained container.
ENV TETHYS_DB_ENGINE=django.db.backends.sqlite3
ENV TETHYS_PERSIST=/var/lib/tethys_persist
ENV TETHYS_DB_NAME=/var/lib/tethys_persist/tethys_platform.sqlite

# 8080 keeps viewOnTethys.sh's CONTAINER_PORT contract intact (and is rootless-Podman safe).
ENV PORT=8080
ENV TETHYS_PORT=8080

# Deliberate, and carried over from the conda image: the visualizer is a local
# single-user tool with no network exposure by default, and a known default login is what
# makes `viewOnTethys.sh` a one-command experience. This trips the SecretsUsedInArgOrEnv
# build check; override both at run time for any shared deployment.
ENV PORTAL_SUPERUSER_NAME=admin
ENV PORTAL_SUPERUSER_PASSWORD=pass

ENV DUCKDB_HOME=/opt/duckdb_extensions

# The old image patched nginx with 600s proxy timeouts because TEEHR/DuckDB queries are
# slow. There is no nginx now: uvicorn (the default) imposes no request timeout, so the
# concern is moot there. This only matters if SERVER=gunicorn is set, whose default
# timeout is 60s and would kill a long warehouse query.
ENV GUNICORN_TIMEOUT=600
ENV GUNICORN_GRACEFUL_TIMEOUT=60

# The base's ENTRYPOINT (_entrypoint.sh) still activates the venv; only CMD changes, so
# provisioning runs before the server starts.
CMD ["/usr/local/bin/ngiab-entrypoint.sh"]
