
FROM tethysplatform/tethys-core:dev

###################
# BUILD ARGUMENTS #
###################

ARG MICRO_TETHYS=true \
    MAMBA_DOCKERFILE_ACTIVATE=1


###################
# ADD APPLICATION #
###################

COPY . ${TETHYS_HOME}/apps



###############
# ENVIRONMENT #
###############
ENV TETHYS_DB_ENGINE=django.db.backends.sqlite3
ENV TETHYS_DB_NAME=
ENV TETHYS_DB_USERNAME=
ENV TETHYS_DB_PASSWORD=
ENV TETHYS_DB_HOST=
ENV TETHYS_DB_PORT=
ENV ENABLE_OPEN_PORTAL=True
ENV PORTAL_SUPERUSER_NAME=admin
ENV PORTAL_SUPERUSER_PASSWORD=pass

#############
# ADD FILES #
#############
RUN micromamba install --yes -c conda-forge --file requirements.txt \
    && micromamba clean --all --yes \
    && cd ${TETHYS_HOME}/apps/tethysapp-ngiab \
    && npm install && npm run build \
    && tethys install -d -N \
    && mv salt /srv/salt/

#########
# PORTS #
#########
EXPOSE 80

#######
# RUN #
#######

CMD bash run.sh