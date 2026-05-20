
FROM tethysplatform/tethys-core:dev-py3.12-dj5.2


###################
# BUILD ARGUMENTS #
###################

ARG MICRO_TETHYS=true \
    MAMBA_DOCKERFILE_ACTIVATE=1


#########################
# ADD APPLICATION FILES #
#########################
COPY --chown=www:www . ${TETHYS_HOME}/apps/ngiab
COPY --chown=www:www run.sh ${TETHYS_HOME}/run.sh

###############
# ENVIRONMENT #
###############
ENV VISUALIZER_CONF=${TETHYS_PERSIST}/ngiab_visualizer/ngiab_visualizer.json
ENV TETHYS_DB_ENGINE=django.db.backends.sqlite3
ENV SKIP_DB_SETUP=True
ENV TETHYS_DB_NAME=
ENV TETHYS_DB_USERNAME=
ENV TETHYS_DB_PASSWORD=
ENV TETHYS_DB_HOST=
ENV TETHYS_DB_PORT=
ENV ENABLE_OPEN_PORTAL=True
ENV PORTAL_SUPERUSER_NAME=admin
ENV PORTAL_SUPERUSER_PASSWORD=pass
ENV PROJ_LIB=/opt/conda/envs/tethys/share/proj

ENV NVM_DIR=/usr/local/nvm
ENV NODE_VERSION=24.14.1
ENV NODE_VERSION_DIR=${NVM_DIR}/versions/node/v${NODE_VERSION}
ENV NODE_PATH=${NODE_VERSION_DIR}/lib/node_modules
ENV PATH=${NODE_VERSION_DIR}/bin:$PATH
ENV NPM=${NODE_VERSION_DIR}/bin/npm

# PDM lives in the tethys conda env; HOME is a dedicated dir owned by www so
# tool caches (DuckDB, pdm, pip) don't land under /root or pollute the app tree.
ENV PDM=/opt/conda/envs/tethys/bin/pdm
# Pin pdm to the conda env's Python so it doesn't make a private .venv under
# the project. Required when SHELL-based conda activation is stripped (Podman
# OCI format does this, Docker preserves it).
ENV PDM_PYTHON=/opt/conda/envs/tethys/bin/python
ENV HOME=/home/www
# Required by salt state tethyscore.sls (ownership of /run/asgi, tethys.log).
ENV NGINX_USER=www
# Default to a non-privileged port so rootless Podman can bind it.
ENV NGINX_PORT=8080
ENV APP_SRC_ROOT=${TETHYS_HOME}/apps/ngiab

# Dedicated HOME for the www user.
RUN mkdir -p ${HOME} && chown www:www ${HOME}

# SETUP
RUN mkdir -p ${NVM_DIR} \
    && curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | /bin/bash \
    && . ${NVM_DIR}/nvm.sh \
    && nvm install ${NODE_VERSION} \
    && nvm alias default ${NODE_VERSION} \
    && nvm use default \
    && ${NODE_VERSION_DIR}/bin/npm install -g npm@latest \
    && ls -la ${NODE_VERSION_DIR} \
    && ls -la ${NODE_VERSION_DIR}/lib \
    && /opt/conda/envs/tethys/bin/pip install --no-cache-dir pdm \
    && test -x ${PDM} \
    && cd ${APP_SRC_ROOT} \
    && git config --global --add safe.directory '*' \
    && git update-index --assume-unchanged


# Current tethys-core base image strips gcc post-build, but pdm picks the
# numpy sdist over the manylinux wheel and needs a compiler. Install and
# remove in the same RUN so the final layer stays small.
# Caveat: temporary; remove once the upstream pdm/numpy resolution is fixed.
RUN cd ${APP_SRC_ROOT} \
    && ${NPM} install \
    && ${NPM} run build \
    && rm -rf node_modules \
    && apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ python3-dev pkg-config \
    && ${PDM} install --no-editable --production \
    && apt-get -y purge gcc g++ python3-dev pkg-config \
    && apt-get -y autoremove \
    && apt-get -y clean \
    && rm -rf /var/lib/apt/lists/*

# Pre-install DuckDB extensions (sqlite, iceberg) into a www-writable, world-readable
# location. Without this, runtime LOAD sqlite fails with:
#   IOException: Failed to create directory "/root/.duckdb": Permission denied
ENV DUCKDB_HOME=${TETHYS_HOME}/duckdb_extensions
RUN mkdir -p ${DUCKDB_HOME} \
    && cd ${APP_SRC_ROOT} \
    && ${PDM} run python -c "import duckdb, os; c=duckdb.connect(); c.execute(f\"SET home_directory='{os.environ['DUCKDB_HOME']}'\"); c.execute(f\"SET extension_directory='{os.environ['DUCKDB_HOME']}'\"); c.execute('INSTALL sqlite'); c.execute('INSTALL iceberg'); print('duckdb extensions installed:', duckdb.__version__)" \
    && chmod -R a+rX ${DUCKDB_HOME}

ADD salt/ /srv/salt/

# Build-time ownership for rootless runtime use.
# /srv/salt is intentionally NOT chowned to www: salt states are executable
#   configuration; a runtime user shouldn't be able to mutate them.
# /run is scoped to /run/supervisor and /run/nginx only.
USER root
RUN mkdir -p \
      ${TETHYS_PERSIST} \
      ${TETHYS_PERSIST}/ngiab_visualizer \
      ${TETHYS_LOG} \
      /run/supervisor \
      /run/nginx \
      /var/log/supervisor \
      /var/log/nginx \
      /var/lib/nginx \
      /var/cache/nginx \
      ${TETHYS_HOME}/duckdb_extensions \
  && chown -R www:www \
      ${TETHYS_HOME}/apps/ngiab \
      ${TETHYS_HOME}/run.sh \
      ${TETHYS_HOME}/duckdb_extensions \
      ${TETHYS_PERSIST} \
      ${TETHYS_LOG} \
      /run/supervisor \
      /run/nginx \
      /var/log/supervisor \
      /var/log/nginx \
      /var/lib/nginx \
      /var/cache/nginx \
  && chmod 755 ${TETHYS_HOME}/run.sh

EXPOSE 8080

CMD bash run.sh

# Absolute path so this survives WORKDIR changes.
HEALTHCHECK --start-period=120s --retries=12 \
    CMD ${TETHYS_HOME}/liveness-probe.sh
