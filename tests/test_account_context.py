"""The page carries what the account row needs, in both single-app and portal mode.

Sign-in is the portal's, not the app's: the URLs are site-root absolute so they are identical
whether this app is served at / or under /apps/<name>/, and neither is reversed from the app's
own namespace.
"""

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


def test_the_auth_urls_are_site_root_not_app_relative(monkeypatch, db):
    """An app-relative sign-in would 404 in single-app mode and miss the portal's in both."""
    context = _context(AnonymousUser(), monkeypatch)

    for key in ("login_url", "logout_url"):
        assert context[key].startswith("/"), context[key]
        assert not context[key].startswith("/apps/"), context[key]
        assert "accounts" in context[key], context[key]


def test_logout_follows_the_same_prefix_as_login(monkeypatch, db):
    """A hardcoded logout 404s on a prefixed portal while sign-in keeps working.

    Tethys rewrites LOGIN_URL when PREFIX_URL is set but cannot rewrite a literal, so logout
    is reversed through the accounts namespace instead of written down.
    """
    monkeypatch.setattr(controllers.settings, "LOGIN_URL", "/portal/accounts/login/")

    context = _context(AnonymousUser(), monkeypatch)

    assert context["login_url"] == "/portal/accounts/login/"
    assert context["logout_url"].endswith("/accounts/logout/")
    assert context["logout_url"] == controllers.logout_url()


def test_the_page_carries_the_running_version(monkeypatch, db):
    """About exists to answer "which build is this", so the context must actually carry one."""
    context = _context(AnonymousUser(), monkeypatch)

    assert context["app_version"], "no version reached the page"
    assert context["app_version"] == controllers.app_version()


def test_a_missing_version_is_empty_rather_than_an_error(monkeypatch, db):
    """Imported from a source tree with no metadata: a developer's machine, not a shipped app."""
    from importlib.metadata import PackageNotFoundError

    def absent(_name):
        raise PackageNotFoundError("tethysapp-ngiab")

    monkeypatch.setattr("importlib.metadata.version", absent)

    assert controllers.app_version() == ""
