"""Reads stay open; writes require a login."""


import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.test import RequestFactory

from tethysapp.ngiab import controllers


@pytest.fixture
def anonymous_post():
    request = RequestFactory().post("/removeModelRun/", {"model_run_id": "alpha"})
    request.user = AnonymousUser()
    return request


@pytest.fixture
def signed_in_post(db, monkeypatch):
    """Signed in *and* permitted. The permission gate is covered in test_delete_permission."""
    monkeypatch.setattr(controllers, "has_permission", lambda request, perm: True)
    request = RequestFactory().post("/removeModelRun/", {"model_run_id": "alpha"})
    request.user = get_user_model()(username="someone", is_active=True)
    return request


def test_tethys_login_required_passes_anonymous_through_under_an_open_portal():
    """An open portal makes Tethys's login_required pass an anonymous caller straight through."""
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


@pytest.mark.parametrize("endpoint", ["removeModelRun"])
def test_every_mutating_endpoint_refuses_an_anonymous_caller(endpoint, anonymous_post):
    """Every mutating endpoint refuses an anonymous caller."""
    response = getattr(controllers, endpoint)(anonymous_post)
    assert response.status_code == 401


def test_the_refusal_says_what_to_do(anonymous_post):
    """The refusal is 401, not 403, so api/client.js redirects to the login page with ?next=."""
    import json

    response = controllers.removeModelRun(anonymous_post)
    assert "Sign in" in json.loads(response.content)["error"]


def test_a_signed_in_caller_gets_past_the_decorator(signed_in_post, tmp_path, monkeypatch):
    """Past authentication, the endpoint's own answer (404 for a run that does not exist) comes back."""
    from tethysapp.ngiab import run_store

    monkeypatch.delenv(run_store.duckdb_conn.STORAGE_BACKEND_ENV, raising=False)
    monkeypatch.setenv(run_store.MANAGED_ROOT_ENV, str(tmp_path))
    run_store.clear_caches()
    assert controllers.removeModelRun(signed_in_post).status_code == 404


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
    ]
    for name in reads:
        view = getattr(controllers, name)
        assert "write_login_required" not in getattr(view, "__qualname__", ""), name
