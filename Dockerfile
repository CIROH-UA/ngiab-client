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
COPY --chmod=0755 scripts/ngiab-convert.sh /usr/local/bin/ngiab-convert.sh

ENV TETHYS_DB_ENGINE=django.db.backends.sqlite3
ENV TETHYS_DB_NAME=/opt/ngiab/tethys_platform.sqlite
ENV STATIC_ROOT=/opt/ngiab/static
ENV TETHYS_PERSIST=/var/lib/tethys_persist

# 8080 keeps viewOnTethys.sh's CONTAINER_PORT contract intact (and is rootless-Podman safe).
ENV PORT=8080
ENV TETHYS_PORT=8080

ENV PORTAL_SUPERUSER_NAME=admin
ENV PORTAL_SUPERUSER_PASSWORD=pass
ENV DUCKDB_HOME=/opt/duckdb_extensions
ENV TETHYS_SECRET_KEY=ngiab-local-default-override-in-any-shared-deployment
ENV GUNICORN_TIMEOUT=600
ENV GUNICORN_GRACEFUL_TIMEOUT=60

# Where the model-run registry actually lives when a writable volume is mounted. The
# entrypoint seeds the baked database here on first start and symlinks the image path at it;
# without the mount the container still runs, just without persistence.
ENV NGIAB_DB_PATH=/var/lib/tethys_persist/db/portal.sqlite

# Provisioning still happens at build time -- this wrapper only seeds the database onto the
# host mount, then execs the base's serve.sh. It needs no privileges (see the script).
CMD ["/usr/local/bin/ngiab-entrypoint.sh"]
