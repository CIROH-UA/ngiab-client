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
c.execute('INSTALL httpfs'); \
c.execute('INSTALL aws'); \
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
# Test: the builder, plus the dev dependencies pytest needs
# ---------------------------------------------------------------------------
# Tests run here rather than in a conda environment on the developer's machine, because the
# base image installs tethys-platform from git main: a locally built environment is a
# different Tethys than the one that ships, so a suite that passes there proves less than it
# appears to. This stage inherits the builder's venv, the provisioned database, the rendered
# portal_config.yml and the DuckDB extension directory, so pytest sees exactly the runtime
# the app is deployed onto.
#
# Dev dependencies are listed in pyproject.toml under [tool.pdm.dev-dependencies], which
# `uv pip install /build` does not install -- hence naming them again here. Keep the two in
# step.
FROM builder AS test

# Pinned, not floored. pyproject.toml's dev-dependencies use >= because pdm.lock does the
# pinning there; nothing locks this stage, so a floating range lets an unrelated pytest
# release break CI. These match pdm.lock so the container and a local `pdm run test` agree.
RUN uv pip install --python "${VIRTUAL_ENV}" \
        pytest==8.3.3 \
        pytest-django==4.9.0 \
        pytest-mock==3.14.0 \
        pytest-cov==6.0.0 \
        pytest-unordered==0.6.1

WORKDIR /build

# --no-cov by default: coverage is a reporting concern for CI to opt into, and addopts in
# pyproject.toml turns it on for every invocation otherwise.
CMD ["/bin/sh", "-c", "\"${VIRTUAL_ENV}/bin/python\" -m pytest -p no:cacheprovider --no-cov"]

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM ghcr.io/aquaveo/tethys-uvx:runtime-base-${TETHYS_UVX_TAG}

# Security floors the base image has not picked up yet. The Grype gate in
# build_and_push_dev_image.yml fails the build on a high-severity finding with a fix
# available: libexpat1, and libpq5 with the postgresql-client-17 it comes from.
#
# The util-linux family below is not yet failing that gate -- CVE-2026-53612..53615 are too
# recent to carry a score, so they read as Unknown and pass. They are upgraded anyway,
# because the fix is already published and the gate would start failing the day NVD scores
# them. Waiting for that turns a one-line bump into a broken build on an unrelated PR.
#
# Named rather than a blanket `apt-get upgrade`, so the next person can see exactly what was
# pinned up and drop it once the base image moves.
#
# The Python-side equivalents (cryptography, sqlparse) are floors in pyproject.toml, which is
# where this repo already keeps urllib3, idna, anyio and ujson for the same reason.
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends --only-upgrade \
        libexpat1 \
        libpq5 \
        postgresql-client-17 \
        bsdutils \
        libblkid1 \
        libmount1 \
        libsmartcols1 \
        libuuid1 \
        login \
        mount \
        util-linux \
    && rm -rf /var/lib/apt/lists/*
USER 1000

COPY --from=builder /opt/python /opt/python
COPY --from=builder /opt/conda /opt/conda
COPY --from=builder /opt/duckdb_extensions /opt/duckdb_extensions
COPY --from=builder --chown=1000:1000 /opt/ngiab /opt/ngiab

COPY --chown=1000:1000 conf/portal_config.yml /config/portal_config.yml
COPY --chown=1000:1000 conf/portal-config.d/ /opt/portal/portal-config.d/
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

# Provisioning happens at build time, so the base image's own server is the whole runtime.
# The database it serves is the baked one; the runs directory is mounted over
# /var/lib/tethys_persist/ngiab_visualizer, which is the registry.
CMD ["/usr/local/bin/serve.sh"]
