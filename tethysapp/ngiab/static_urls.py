"""Serve STATIC_ROOT when DEBUG is off.

Tethys under tethys-uvx has no nginx and upstream expects a CDN, so with DEBUG false nothing
answers /static/ and the app loads a blank page. Keeping DEBUG true to work around that costs
more than it looks: it puts the Django dev server in front of every deployment, which brings
the autoreloader -- and the autoreloader is what makes `docker stop` take ten seconds, restarts
the server whenever a file is touched, and dies with EACCES under Apptainer.

Django's own static view rather than whitenoise: it needs no new dependency, and it supports
conditional GET, so a browser can revalidate with a 304 instead of refetching every module.
The trade is no compression, and it runs through the full middleware stack. For a local,
single-user viewer serving a few hundred files that is a fair trade; for a shared multi-user
deployment, add whitenoise instead and drop the ADDITIONAL_URLPATTERNS entry from
portal_config.yml.

Cache-Control is set explicitly because the view does not send one, and without it a browser
picks its own freshness lifetime and may skip revalidating altogether. Nothing here is
content-hashed -- a build-less app imports its modules by plain relative path, so there is no
name to bust -- which means a cached module can outlive the release it came from: after an
upgrade the page loads new markup against old components, and the failures look like data
bugs rather than stale files. no-cache keeps the files cacheable but forces the conditional
GET, so the common case is still a 304 with an empty body.

Wired in through TETHYS_PORTAL_CONFIG.ADDITIONAL_URLPATTERNS, which Tethys imports and appends
to the root urlconf.
"""

import re

from django.conf import settings
from django.urls import re_path
from django.views.static import serve as django_serve

# STATIC_URL is "/static/" by default but may be prefixed; strip the leading slash so the
# pattern is relative to the root urlconf, and escape it so a dot cannot become a wildcard.
_prefix = re.escape((settings.STATIC_URL or "/static/").lstrip("/"))

def serve(request, path, document_root=None, show_indexes=False):
    """Django's static view, with revalidation made mandatory."""
    response = django_serve(request, path, document_root, show_indexes)
    response.headers["Cache-Control"] = "no-cache"
    return response


urlpatterns = [
    re_path(
        rf"^{_prefix}(?P<path>.*)$",
        serve,
        {"document_root": settings.STATIC_ROOT},
        name="ngiab_static",
    ),
]
