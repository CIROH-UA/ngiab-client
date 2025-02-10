
{% set TETHYS_PERSIST = salt['environ.get']('TETHYS_PERSIST') %}
{% set CLIENT_MAX_BODY_SIZE = salt['environ.get']('CLIENT_MAX_BODY_SIZE') %}
{% set NGINX_PORT = salt['environ.get']('NGINX_PORT') %}
{% set TETHYS_PORT = salt['environ.get']('TETHYS_PORT') %}
{% set CSRF_TRUSTED_ORIGINS = salt['environ.get']('CSRF_TRUSTED_ORIGINS') %}


PATCH_Generate_NGINX_Settings_TethysCore:
  cmd.run:
    - name: >
        tethys gen nginx
        --tethys-port {{ TETHYS_PORT }}
        --client-max-body-size {{ CLIENT_MAX_BODY_SIZE }}
        --web-server-port {{ NGINX_PORT }}
        --overwrite
    - unless: /bin/bash -c "[ -f "{{ TETHYS_PERSIST }}/patch_complete" ];"

PATCH_Portal_Settings_TethysCore:
  cmd.run:
    - name: >
        tethys settings
        --set CSRF_TRUSTED_ORIGINS {{ CSRF_TRUSTED_ORIGINS }}
    - unless: /bin/bash -c "[ -f "{{ TETHYS_PERSIST }}/patch_complete" ];"


Flag_Complete_Setup:
  cmd.run:
    - name: touch ${TETHYS_PERSIST}/patch_complete
    - shell: /bin/bash