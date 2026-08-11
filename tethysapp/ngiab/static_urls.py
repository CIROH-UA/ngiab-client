"""Serve STATIC_ROOT when DEBUG is off.

Tethys under tethys-uvx has no nginx and upstream expects a CDN, so with DEBUG false nothing
answers /static/ and the app loads a blank page. Keeping DEBUG true to work around that costs
more than it looks: it puts the Django dev server in front of every deployment, which brings
the autoreloader -- and the autoreloader is what makes `docker stop` take ten seconds, restarts
the server whenever a file is touched, and dies with EACCES under Apptainer.

Django's own static view rather than whitenoise: it needs no new dependency, and it supports
conditional GET, so a browser revalidates with 304s instead of refetching every module on each
load. The trade is that it has no far-future cache headers and no compression, and it runs
through the full middleware stack. For a local, single-user viewer serving a few hundred files
that is a fair trade; for a shared multi-user deployment, add whitenoise instead and drop the
ADDITIONAL_URLPATTERNS entry from portal_config.yml.

Wired in through TETHYS_PORTAL_CONFIG.ADDITIONAL_URLPATTERNS, which Tethys imports and appends
to the root urlconf.
"""

import re

from django.conf import settings
from django.urls import re_path
from django.views.static import serve

# STATIC_URL is "/static/" by default but may be prefixed; strip the leading slash so the
# pattern is relative to the root urlconf, and escape it so a dot cannot become a wildcard.
_prefix = re.escape((settings.STATIC_URL or "/static/").lstrip("/"))

urlpatterns = [
    re_path(
        rf"^{_prefix}(?P<path>.*)$",
        serve,
        {"document_root": settings.STATIC_ROOT},
        name="ngiab_static",
    ),
]
