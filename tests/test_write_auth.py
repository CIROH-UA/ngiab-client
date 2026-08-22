"""Reads stay open; writes require a login. And the image's shipped credentials do not ship.

Read docs/plans/2026-08-22-001-feat-storage-backed-model-runs-plan.md, Unit 6.

This lands before Unit 8 on purpose. Unit 8 makes removing a run delete its directory, and
the ordering matters more than it looks: ``ENABLE_OPEN_PORTAL: true`` leaves every endpoint
reachable by anyone, so shipping the destructive version first would open a window in which
an anonymous POST irreversibly destroys someone's model output. Authentication first, then
the thing worth authenticating.
"""


import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import RequestFactory

from tethysapp.ngiab import controllers
from tethysapp.ngiab.management.commands import ensure_superuser


@pytest.fixture
def anonymous_post():
    request = RequestFactory().post("/removeModelRun/", {"model_run_id": "alpha"})
    request.user = AnonymousUser()
    return request


@pytest.fixture
def signed_in_post(db):
    request = RequestFactory().post("/removeModelRun/", {"model_run_id": "alpha"})
    request.user = get_user_model()(username="someone", is_active=True)
    return request


# ---- Tethys's decorator is inert here; Django's is not ---------------------


def test_tethys_login_required_passes_anonymous_through_under_an_open_portal():
    """The claim the whole design rests on, asserted rather than assumed.

    conf/portal_config.yml says an open portal makes Tethys's login_required "pass straight
    through", and tethys_apps/decorators.py checks the setting at call time. If that ever
    stopped being true this design would be over-protecting rather than under-protecting,
    but it is worth knowing either way.
    """
    from django.conf import settings
    from tethys_apps.decorators import login_required as tethys_login_required

    assert settings.ENABLE_OPEN_PORTAL is True

    @tethys_login_required()
    def view(request):
        from django.http import HttpResponse

        return HttpResponse("reached")

    request = RequestFactory().get("/x/")
    request.user = AnonymousUser()
    assert view(request).status_code == 200


def test_our_decorator_refuses_the_same_request():
    """Django's authentication is not bypassed by the open-portal setting."""
    from django.http import HttpResponse

    @controllers.write_login_required
    def view(request):
        return HttpResponse("reached")

    request = RequestFactory().post("/x/")
    request.user = AnonymousUser()
    assert view(request).status_code == 401


# ---- The endpoints themselves ----------------------------------------------


@pytest.mark.parametrize("endpoint", ["removeModelRun", "registerModelRun"])
def test_every_mutating_endpoint_refuses_an_anonymous_caller(endpoint, anonymous_post):
    response = getattr(controllers, endpoint)(anonymous_post)
    assert response.status_code == 401


def test_the_refusal_says_what_to_do(anonymous_post):
    """401 rather than 403 so api/client.js redirects to the login page with ?next=.

    A 403 would surface a sentence and leave the user to work out where to sign in; a Django
    redirect would be worse still, because fetch follows it and the client would receive the
    login page's HTML with a 200 and report unreadable JSON.
    """
    import json

    response = controllers.removeModelRun(anonymous_post)
    assert "Sign in" in json.loads(response.content)["error"]


def test_a_signed_in_caller_gets_past_the_decorator(signed_in_post):
    """Past authentication, removeModelRun's own 501 is what answers -- see Unit 5.

    The point is only that the decorator is not what stopped it.
    """
    assert controllers.removeModelRun(signed_in_post).status_code == 501


def test_reads_are_untouched():
    """The portal stays open. Only the endpoints that change something are wrapped."""
    reads = [
        "getModelRuns",
        "getCatchmentTimeSeries",
        "getCatchmentVariables",
        "getCatchmentValueMatrix",
        "getGeoSpatialData",
        "getTrouteVariables",
        "getTrouteTimeSeries",
        "getTeehrTimeSeries",
        "getTeehrVariables",
        "getTeehrLocations",
        "scanModelRuns",
    ]
    for name in reads:
        view = getattr(controllers, name)
        assert "write_login_required" not in getattr(view, "__qualname__", ""), name


# ---- Shipped credentials --------------------------------------------------


@pytest.fixture
def hosted(monkeypatch):
    monkeypatch.setenv("NGIAB_STORAGE_BACKEND", "s3")


@pytest.fixture
def local(monkeypatch):
    monkeypatch.delenv("NGIAB_STORAGE_BACKEND", raising=False)


def test_hosted_refuses_the_baked_password(hosted, monkeypatch):
    """admin/pass is in a public image, and an ephemeral database restores it every restart."""
    monkeypatch.setenv("PORTAL_SUPERUSER_PASSWORD", ensure_superuser.BAKED_PASSWORD)
    monkeypatch.setenv("TETHYS_SECRET_KEY", "something-of-our-own")
    with pytest.raises(CommandError) as excinfo:
        call_command("ensure_superuser", "--check-only")
    assert "baked default" in str(excinfo.value)


def test_hosted_refuses_the_baked_secret_key(hosted, monkeypatch):
    """A session cookie signed with a published key can be forged."""
    monkeypatch.setenv("PORTAL_SUPERUSER_PASSWORD", "chosen-by-the-operator")
    monkeypatch.setenv("TETHYS_SECRET_KEY", ensure_superuser.BAKED_SECRET_KEY)
    with pytest.raises(CommandError) as excinfo:
        call_command("ensure_superuser", "--check-only")
    assert "TETHYS_SECRET_KEY" in str(excinfo.value)


def test_hosted_reports_both_problems_at_once(hosted, monkeypatch):
    """One restart should surface everything wrong, not the first thing wrong."""
    monkeypatch.setenv("PORTAL_SUPERUSER_PASSWORD", ensure_superuser.BAKED_PASSWORD)
    monkeypatch.setenv("TETHYS_SECRET_KEY", ensure_superuser.BAKED_SECRET_KEY)
    with pytest.raises(CommandError) as excinfo:
        call_command("ensure_superuser", "--check-only")
    message = str(excinfo.value)
    assert "PORTAL_SUPERUSER_PASSWORD" in message and "TETHYS_SECRET_KEY" in message


def test_hosted_accepts_credentials_of_its_own(hosted, monkeypatch):
    monkeypatch.setenv("PORTAL_SUPERUSER_PASSWORD", "chosen-by-the-operator")
    monkeypatch.setenv("TETHYS_SECRET_KEY", "chosen-by-the-operator")
    call_command("ensure_superuser", "--check-only")


def test_local_keeps_the_baked_defaults(local, monkeypatch):
    """A laptop container must still start with no configuration at all.

    The baked superuser exists so the image is usable the moment it runs, and on a machine
    the user already controls that is a convenience rather than an exposure.
    """
    monkeypatch.setenv("PORTAL_SUPERUSER_PASSWORD", ensure_superuser.BAKED_PASSWORD)
    monkeypatch.setenv("TETHYS_SECRET_KEY", ensure_superuser.BAKED_SECRET_KEY)
    call_command("ensure_superuser", "--check-only")


# ---- Provisioning ----------------------------------------------------------


def test_a_superuser_is_created_from_the_environment(db, local, monkeypatch):
    monkeypatch.setenv("PORTAL_SUPERUSER_NAME", "operator")
    monkeypatch.setenv("PORTAL_SUPERUSER_PASSWORD", "a-real-password")
    monkeypatch.setenv("PORTAL_SUPERUSER_EMAIL", "operator@example.org")
    call_command("ensure_superuser")

    user = get_user_model().objects.get(username="operator")
    assert user.is_superuser and user.is_staff
    assert user.check_password("a-real-password")


def test_rerunning_updates_rather_than_failing(db, local, monkeypatch):
    """The entrypoint runs this on every start, so it has to be idempotent."""
    monkeypatch.setenv("PORTAL_SUPERUSER_NAME", "operator")
    monkeypatch.setenv("PORTAL_SUPERUSER_PASSWORD", "first-password")
    call_command("ensure_superuser")

    monkeypatch.setenv("PORTAL_SUPERUSER_PASSWORD", "second-password")
    call_command("ensure_superuser")

    user = get_user_model().objects.get(username="operator")
    assert user.check_password("second-password")
    assert get_user_model().objects.filter(username="operator").count() == 1


def test_no_credentials_leaves_the_database_alone(db, local, monkeypatch):
    monkeypatch.delenv("PORTAL_SUPERUSER_NAME", raising=False)
    monkeypatch.delenv("PORTAL_SUPERUSER_PASSWORD", raising=False)
    before = get_user_model().objects.count()
    call_command("ensure_superuser")
    assert get_user_model().objects.count() == before


def test_hosted_refuses_a_baked_key_that_only_reaches_settings(hosted, monkeypatch, settings):
    """The environment and the key Django signs with can disagree.

    The runtime stage sets the default through ENV and portal-config.sh merges it into the
    rendered config. An operator who exports a good value that never reaches settings would
    pass an environment-only check while still signing cookies with the published key.
    """
    monkeypatch.setenv("PORTAL_SUPERUSER_PASSWORD", "chosen-by-the-operator")
    monkeypatch.setenv("TETHYS_SECRET_KEY", "chosen-by-the-operator")
    settings.SECRET_KEY = ensure_superuser.BAKED_SECRET_KEY

    with pytest.raises(CommandError) as excinfo:
        call_command("ensure_superuser", "--check-only")
    assert "TETHYS_SECRET_KEY" in str(excinfo.value)
