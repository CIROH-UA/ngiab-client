"""Serve the app's static files, which nothing else does under tethys-uvx."""

import re

from django.conf import settings
from django.urls import re_path
from django.views.static import serve as django_serve

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
