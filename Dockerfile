
FROM gioelkin/tethys-ngiab:dev-r1

###################
# BUILD ARGUMENTS #
###################

ARG MICRO_TETHYS=true \
    MAMBA_DOCKERFILE_ACTIVATE=1


#########################
# ADD APPLICATION FILES #
#########################
COPY . ${TETHYS_HOME}/apps/ngiab


###############
# ENVIRONMENT #
###############
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

# fix error for numpy not being imported. libquadmath not found
RUN apt-get update \
    && apt-get -y install gfortran \
    && rm -rf /var/lib/apt/lists/*

#######################
# INSTALL APPLICATION #
#######################

RUN cd ${TETHYS_HOME}/apps/ngiab && \ 
    micromamba install --yes -c conda-forge --file requirements.txt  && \
    micromamba remove pyarrow && micromamba install --yes -c conda-forge pyarrow && \
    micromamba clean --all --yes && \
    npm install && npm run build && \
    tethys install -d -N && \
    export NGINX_USER=$(grep 'user .*;' /etc/nginx/nginx.conf | awk '{print $2}' | awk -F';' '{print $1}') && \
    chown -R ${NGINX_USER}: ${TETHYS_PERSIST} && \
    chown -R ${NGINX_USER}: ${STATIC_ROOT} && \
    chown -R ${NGINX_USER}: ${WORKSPACE_ROOT} && \
    chown -R ${NGINX_USER}: ${MEDIA_ROOT} && \
    chown -R ${NGINX_USER}: ${TETHYS_HOME}/apps/ngiab && \
    chown -R ${NGINX_USER}: ${TETHYS_HOME}

#########
# PORTS #
#########
EXPOSE 80

#######
# RUN #
#######

CMD ["bash", "run.sh", "--skip-perm"]