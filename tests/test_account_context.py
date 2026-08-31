"""The page carries what the account row needs, in both single-app and portal mode.

Sign-in is the portal's, not the app's: the URLs are site-root absolute so they are identical
whether this app is served at / or under /apps/<name>/, and neither is reversed from the app's
own namespace.
"""

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.http import HttpResponse
from django.test import RequestFactory

from tethysapp.ngiab import controllers


def _context(user, monkeypatch, *, permitted=False):
    monkeypatch.setattr(controllers, "may_manage_runs", lambda request: permitted)
    captured = {}

    def render(request, template, context):
        captured.update(context)
        return HttpResponse("rendered")

    monkeypatch.setattr(controllers.App, "render", staticmethod(render))
    request = RequestFactory().get("/")
    request.user = user
    controllers.home(request)
    return captured


def test_a_guest_gets_no_name_but_still_gets_the_way_in(monkeypatch, db):
    context = _context(AnonymousUser(), monkeypatch)

    assert context["signed_in"] is False
    assert context["username"] == ""
    assert context["login_url"] and context["logout_url"]


def test_a_signed_in_user_is_named(monkeypatch, db):
    user = get_user_model()(username="hydro", is_active=True)

    context = _context(user, monkeypatch)

    assert context["signed_in"] is True
    assert context["username"] == "hydro"


@pytest.mark.parametrize("permitted", [True, False])
def test_the_delete_flag_is_the_permission_not_the_session(monkeypatch, db, permitted):
    """can_delete carries the permission alone; the frontend requires a session as well."""
    user = get_user_model()(username="hydro", is_active=True)

    context = _context(user, monkeypatch, permitted=permitted)

    assert context["can_delete"] is permitted


def test_the_auth_urls_are_site_root_not_app_relative(monkeypatch, db):
    """An app-relative sign-in would 404 in single-app mode and miss the portal's in both."""
    context = _context(AnonymousUser(), monkeypatch)

    for key in ("login_url", "logout_url"):
        assert not context[key].startswith("/apps/"), context[key]
        assert "accounts" in context[key], context[key]
