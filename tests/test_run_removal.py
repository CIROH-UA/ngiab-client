"""Removing a run now deletes it, and the migration that made that necessary.
Signing in and resolving by listed name replace the separation the old no-op relied on."""

import os

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.test import RequestFactory

from tethysapp.ngiab import controllers, manifest, run_store


@pytest.fixture
def populated_root(tmp_path, mini_run_factory, monkeypatch):
    root = tmp_path / "ngiab_visualizer"
    root.mkdir()
    for name in ("alpha", "beta"):
        source = mini_run_factory(name=f"src-{name}")
        manifest.write(source, manifest.distill(source, run_id=name, label=name))
        os.rename(source, root / name)

    monkeypatch.delenv(run_store.duckdb_conn.STORAGE_BACKEND_ENV, raising=False)
    monkeypatch.setenv(run_store.MANAGED_ROOT_ENV, str(root))
    monkeypatch.setenv(run_store.LISTING_TTL_ENV, "0")
    run_store.clear_caches()
    return root


def _post(name, user=None):
    request = RequestFactory().post("/removeModelRun/", {"model_run_id": name})
    request.user = user or AnonymousUser()
    return request


@pytest.fixture
def signed_in(db, monkeypatch):
    """A user who may delete. Signing in stopped being enough; see test_delete_permission."""
    from tethysapp.ngiab import controllers as _c

    monkeypatch.setattr(_c, "has_permission", lambda request, perm: True)
    return get_user_model()(username="operator", is_active=True)


def test_removing_a_run_deletes_its_directory(populated_root):
    run_store.delete("alpha")
    assert not (populated_root / "alpha").exists()
    assert (populated_root / "beta").exists()


def test_the_run_does_not_come_back_on_the_next_listing(populated_root):
    """A deleted run must not resurrect on the next listing, the way it did under the old registry."""
    run_store.delete("alpha")
    assert [entry["name"] for entry in run_store.list_runs()] == ["beta"]


def test_removing_the_only_run_leaves_an_empty_listing(populated_root):
    run_store.delete("alpha")
    run_store.delete("beta")
    assert run_store.list_runs() == []


@pytest.mark.parametrize(
    "name",
    ["../beta", "../../etc", "alpha/../../beta", "/etc", "", "does-not-exist"],
)
def test_only_a_name_the_listing_returned_can_be_deleted(populated_root, name):
    """Only a name the listing actually returned can be deleted; a path is never accepted."""
    with pytest.raises(LookupError):
        run_store.delete(name)
    assert (populated_root / "alpha").exists()
    assert (populated_root / "beta").exists()


def test_a_symlink_planted_in_the_root_is_not_followed_out(populated_root, tmp_path):
    """A run directory is deleted; a link pretending to be one is not a way out of the root."""
    outside = tmp_path / "precious"
    outside.mkdir()
    (outside / "keep.txt").write_text("do not delete me")
    os.symlink(outside, populated_root / "sneaky")
    run_store.clear_caches()

    with pytest.raises(LookupError):
        run_store.delete("sneaky")
    assert (outside / "keep.txt").exists()


def test_an_anonymous_caller_cannot_delete(populated_root):
    assert controllers.removeModelRun(_post("alpha")).status_code == 401
    assert (populated_root / "alpha").exists()


def test_a_signed_in_caller_can(populated_root, signed_in):
    response = controllers.removeModelRun(_post("alpha", signed_in))
    assert response.status_code == 200
    assert not (populated_root / "alpha").exists()


def test_an_unknown_name_is_a_404(populated_root, signed_in):
    assert controllers.removeModelRun(_post("nope", signed_in)).status_code == 404


def test_a_missing_name_is_a_400(populated_root, signed_in):
    assert controllers.removeModelRun(_post("", signed_in)).status_code == 400


def test_the_importer_endpoints_are_gone():
    """Presence in the storage root is registration; there is nothing left to register."""
    assert not hasattr(controllers, "scanModelRuns")
    assert not hasattr(controllers, "registerModelRun")


def test_the_registry_table_is_dropped(db):
    from django.db import connection

    assert "ngiab_modelrun" not in connection.introspection.table_names()


def test_the_earlier_migrations_are_kept():
    """The earlier migrations are kept, so the table's history is not orphaned."""
    from tethysapp.ngiab import migrations

    directory = os.path.dirname(migrations.__file__)
    present = sorted(f for f in os.listdir(directory) if f.endswith(".py"))
    assert "0001_initial.py" in present
    assert "0002_normalize_model_run_ids.py" in present
    assert "0003_delete_modelrun.py" in present


def test_the_migration_is_a_pure_delete(db):
    """The backfill runs as a command before migrate, not as work inside the migration itself."""
    from importlib import import_module

    module = import_module("tethysapp.ngiab.migrations.0003_delete_modelrun".replace("0003", "0003"))
    operations = module.Migration.operations
    assert len(operations) == 1
    assert type(operations[0]).__name__ == "DeleteModel"
