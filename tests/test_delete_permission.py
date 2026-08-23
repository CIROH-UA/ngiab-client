"""Deleting a run takes a permission, not just a session.

Signing in was the entire gate before this. That was proportionate while a deployment was one
person's laptop and the storage root was their own directory. On a portal shared by an
institution, and a bucket shared by everyone on it, "signed in" is not a meaningful
restriction on an irreversible action: one user's misclick is another user's lost output.

The permission is declared in App.permissions, so a portal administrator grants it through the
same admin interface they already use. Superusers hold it implicitly.
"""

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.test import RequestFactory

from tethysapp.ngiab import controllers


def _post(user):
    request = RequestFactory().post("/removeModelRun/", {"model_run_id": "alpha"})
    request.user = user
    return request


@pytest.fixture
def permitted(monkeypatch):
    """A user the permission system says yes to, without needing an installed app row."""
    monkeypatch.setattr(controllers, "has_permission", lambda request, perm: True)


@pytest.fixture
def refused(monkeypatch):
    monkeypatch.setattr(controllers, "has_permission", lambda request, perm: False)


# ---- The three answers ------------------------------------------------------


def test_anonymous_is_told_to_sign_in(refused):
    """401, so api/client.js redirects to the login page rather than showing a message."""
    response = controllers.removeModelRun(_post(AnonymousUser()))
    assert response.status_code == 401


def test_a_signed_in_user_without_the_permission_is_refused(db, refused):
    """403, not 401: they are past the login page, and sending them back would loop."""
    user = get_user_model()(username="viewer", is_active=True)
    response = controllers.removeModelRun(_post(user))
    assert response.status_code == 403
    assert b"permission" in response.content


def test_a_granted_user_reaches_the_view(db, permitted):
    """Past the gate the run still has to exist -- 404 proves the delete was attempted."""
    user = get_user_model()(username="curator", is_active=True)
    response = controllers.removeModelRun(_post(user))
    assert response.status_code == 404


def test_a_superuser_needs_no_grant(db, refused):
    """Answered from the user object, so an administrator works even if app lookup fails."""
    user = get_user_model()(username="root", is_active=True, is_superuser=True)
    assert controllers.may_manage_runs(_post(user)) is True
    assert controllers.removeModelRun(_post(user)).status_code == 404


# ---- Failure denies ---------------------------------------------------------


def test_a_broken_permission_lookup_denies(db, monkeypatch):
    """The only action behind this destroys data, so an unanswerable question is a no."""
    def explode(request, perm):
        raise RuntimeError("no app context")

    monkeypatch.setattr(controllers, "has_permission", explode)
    user = get_user_model()(username="viewer", is_active=True)
    assert controllers.may_manage_runs(_post(user)) is False
    assert controllers.removeModelRun(_post(user)).status_code == 403


def test_an_inactive_session_is_not_authenticated(refused):
    assert controllers.may_manage_runs(_post(AnonymousUser())) is False


# ---- The declaration itself -------------------------------------------------


def test_the_app_declares_the_permission():
    """A permission the app never declares cannot be granted in the admin."""
    from tethysapp.ngiab.app import App

    groups = App().permissions()
    names = [p.name for group in groups for p in group.permissions]
    assert controllers.DELETE_PERMISSION in names


# ---- The page tells the frontend what to render -----------------------------


def _home_context(user, monkeypatch):
    """Render the map page and capture the context it hands the template."""
    captured = {}

    def fake_render(request, template, context):
        captured.update(context)
        from django.http import HttpResponse

        return HttpResponse("ok")

    monkeypatch.setattr(controllers.App, "render", staticmethod(fake_render))
    request = RequestFactory().get("/")
    request.user = user
    controllers.home(request)
    return captured


def test_the_page_is_told_a_granted_user_may_delete(db, permitted, monkeypatch):
    user = get_user_model()(username="curator", is_active=True)
    context = _home_context(user, monkeypatch)
    assert context["signed_in"] is True
    assert context["can_delete"] is True


def test_the_page_is_told_a_refused_user_may_not(db, refused, monkeypatch):
    """The control is hidden for them, because for them it is a dead end rather than a login."""
    user = get_user_model()(username="viewer", is_active=True)
    context = _home_context(user, monkeypatch)
    assert context["signed_in"] is True
    assert context["can_delete"] is False


def test_an_anonymous_visitor_is_marked_signed_out(refused, monkeypatch):
    """Signed out keeps the control visible, so the 401 can send them to sign in."""
    context = _home_context(AnonymousUser(), monkeypatch)
    assert context["signed_in"] is False
    assert context["can_delete"] is False


# ---- Not merely failing closed ----------------------------------------------


@pytest.fixture
def installed_app(db):
    """The TethysApp row a real portal has, which is what has_permission resolves through.

    Without it get_active_app returns None and every check denies. That is the correct
    failure, but a gate that only ever says no is indistinguishable from a broken one, so
    this exercises the real Tethys path rather than a stub.
    """
    from tethys_apps.models import TethysApp

    return TethysApp.objects.create(
        package="ngiab", name="NGIAB Visualizer", root_url="ngiab"
    )


def _grant(user, app):
    """Grant the app permission the way the Tethys admin does.

    Object-level, through guardian, and not ``user_permissions.add``. Tethys checks
    ``user.has_perm(perm, app)`` with the app as the object, and Django's ModelBackend
    refuses any check that carries one -- so a model-level grant reads as no grant at all.
    ``guardian.backends.ObjectPermissionBackend`` is the second backend in the portal's
    settings and is what actually answers.
    """
    from django.contrib.auth.models import Permission
    from django.contrib.contenttypes.models import ContentType
    from guardian.shortcuts import assign_perm
    from tethys_apps.models import TethysApp

    codename = f"{app.package}:{controllers.DELETE_PERMISSION}"
    Permission.objects.get_or_create(
        codename=codename,
        content_type=ContentType.objects.get_for_model(TethysApp),
        defaults={"name": "Delete model runs"},
    )
    assign_perm(f"tethys_apps.{codename}", user, app)
    # has_perm caches on the user instance, so re-read rather than reuse.
    return get_user_model().objects.get(pk=user.pk)


def test_a_real_grant_is_honoured(installed_app):
    """The whole point: an administrator can hand this to a curator and it takes effect."""
    user = get_user_model().objects.create_user(username="curator", password="x")
    granted = _grant(user, installed_app)
    assert controllers.may_manage_runs(_post(granted)) is True


def test_a_user_without_the_grant_is_still_refused(installed_app):
    """Same app context, no grant -- so the True above came from the permission, not the row."""
    user = get_user_model().objects.create_user(username="viewer", password="x")
    assert controllers.may_manage_runs(_post(user)) is False
