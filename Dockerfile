ARG TETHYS_UVX_TAG=a3148d5

# ---------------------------------------------------------------------------
# Build: install the app, then provision the SQLite DB and collect static
# ---------------------------------------------------------------------------
FROM ghcr.io/aquaveo/tethys-uvx:builder-${TETHYS_UVX_TAG} AS builder

WORKDIR /build
COPY . /build

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

ENV TETHYS_DB_ENGINE=django.db.backends.sqlite3
ENV TETHYS_DB_NAME=/home/tethys/ngiab/tethys_platform.sqlite
ENV STATIC_ROOT=/home/tethys/ngiab/static
ENV PORTAL_SUPERUSER_NAME=admin
ENV PORTAL_SUPERUSER_PASSWORD=pass

COPY conf/portal_config.yml ${TETHYS_HOME}/portal_config.yml

RUN mkdir -p /home/tethys/ngiab/static \
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
    && chown -R 1000:1000 /home/tethys/ngiab \
    && test -s /home/tethys/ngiab/tethys_platform.sqlite \
    && echo "baked db: $(stat -c%s /home/tethys/ngiab/tethys_platform.sqlite) bytes" \
    && echo "baked static: $(find /home/tethys/ngiab/static -type f | wc -l) files"

# ---------------------------------------------------------------------------
# Test: the builder, plus the dev dependencies pytest needs
# ---------------------------------------------------------------------------
FROM builder AS test

RUN uv pip install --python "${VIRTUAL_ENV}" \
        pytest==8.3.3 \
        pytest-django==4.9.0 \
        pytest-mock==3.14.0 \
        pytest-cov==6.0.0 \
        pytest-unordered==0.6.1

WORKDIR /build

CMD ["/bin/sh", "-c", "\"${VIRTUAL_ENV}/bin/python\" -m pytest -p no:cacheprovider --no-cov"]

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM ghcr.io/aquaveo/tethys-uvx:runtime-base-${TETHYS_UVX_TAG}

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends --only-upgrade \
        libexpat1 \
        libpq5 \
        openssl \
        libssl3t64 \
        openssl-provider-legacy \
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
COPY --from=builder --chown=1000:1000 /home/tethys/ngiab /home/tethys/ngiab

COPY --chown=1000:1000 conf/portal_config.yml /config/portal_config.yml
COPY --chown=1000:1000 conf/portal-config.d/ /opt/portal/portal-config.d/
COPY --chmod=0755 scripts/ngiab-convert.sh /usr/local/bin/ngiab-convert.sh

ENV TETHYS_DB_ENGINE=django.db.backends.sqlite3
ENV TETHYS_PERSIST=/home/tethys/persist
ENV TETHYS_DB_NAME=/home/tethys/ngiab/tethys_platform.sqlite
ENV STATIC_ROOT=/home/tethys/ngiab/static

ENV PORT=8080
ENV TETHYS_PORT=8080

ENV DUCKDB_HOME=/opt/duckdb_extensions
ENV TETHYS_SECRET_KEY=ngiab-local-default-override-in-any-shared-deployment
ENV GUNICORN_TIMEOUT=600
ENV GUNICORN_GRACEFUL_TIMEOUT=60

CMD ["/usr/local/bin/serve.sh"]
