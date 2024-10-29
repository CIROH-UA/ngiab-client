
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


RUN apt-get update \
    && apt-get -y install gfortran \
    && rm -rf /var/lib/apt/lists/*

#######################
# INSTALL APPLICATION #
#######################
RUN cd ${TETHYS_HOME}/apps/ngiab && \ 
    micromamba install --yes -c conda-forge --file requirements.txt  && \
    micromamba clean --all --yes && \
    npm install && npm run build && \
    tethys install -d -N

#########
# PORTS #
#########
EXPOSE 80

#######
# RUN #
#######

CMD ["bash", "run.sh", "--skip-perm"]