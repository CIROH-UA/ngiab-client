"""Removing a run now deletes it, and the migration that made that necessary.

Read docs/plans/2026-08-22-001-feat-storage-backed-model-runs-plan.md, Unit 8.

This reverses a decision the project made deliberately: commit 56532a9 removed the last
``os.remove`` from the codebase, on the grounds that destroying someone's model output because
they tidied a list was too much damage for an unregister action. It is reversed knowingly,
because with the listing derived from storage a removal that does not delete cannot work --
the run reappears on the next scan. That is not a theory: under the old JSON registry,
deleting the sole run brought it back on the next request, which made unregistering look
broken.

Two things carry the weight the old separation used to: the endpoint is unreachable without
signing in (Unit 6, which landed first for exactly this reason), and it takes a run *name*
that the listing already returned rather than a path, so a caller cannot describe a directory
of its own choosing at all.
"""

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
def signed_in(db):
    return get_user_model()(username="operator", is_active=True)


# ---- It actually deletes ----------------------------------------------------


def test_removing_a_run_deletes_its_directory(populated_root):
    run_store.delete("alpha")
    assert not (populated_root / "alpha").exists()
    assert (populated_root / "beta").exists()


def test_the_run_does_not_come_back_on_the_next_listing(populated_root):
    """The resurrection bug, asserted directly.

    Under the JSON registry, deleting the sole run brought it back on the next request. Any
    scheme where removal does not delete reintroduces it, which is why a hidden-marker file
    was rejected in favour of this.
    """
    run_store.delete("alpha")
    assert [entry["name"] for entry in run_store.list_runs()] == ["beta"]


def test_removing_the_only_run_leaves_an_empty_listing(populated_root):
    run_store.delete("alpha")
    run_store.delete("beta")
    assert run_store.list_runs() == []


# ---- It cannot be pointed at anything else ----------------------------------


@pytest.mark.parametrize(
    "name",
    ["../beta", "../../etc", "alpha/../../beta", "/etc", "", "does-not-exist"],
)
def test_only_a_name_the_listing_returned_can_be_deleted(populated_root, name):
    """The same invariant the old importer enforced from the other side.

    registerModelRun accepted a path only if a fresh scan would offer that exact path, and
    a978b2d verified it against ``../..`` and symlinks planted inside the root. Resolving
    through the listing is the stronger version: a path is never accepted at all, so there is
    no traversal to defend against.
    """
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


# ---- Through the endpoint ---------------------------------------------------


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


# ---- The migration ----------------------------------------------------------


def test_the_registry_table_is_dropped(db):
    from django.db import connection

    assert "ngiab_modelrun" not in connection.introspection.table_names()


def test_the_earlier_migrations_are_kept():
    """Deleting 0001 and 0002 would orphan both the table and the history.

    Every existing deployment has their rows in django_migrations and the table on a host
    volume. Removing the files would leave the table on disk forever, with Django no longer
    able to drop it.
    """
    from tethysapp.ngiab import migrations

    directory = os.path.dirname(migrations.__file__)
    present = sorted(f for f in os.listdir(directory) if f.endswith(".py"))
    assert "0001_initial.py" in present
    assert "0002_normalize_model_run_ids.py" in present
    assert "0003_delete_modelrun.py" in present


def test_the_migration_is_a_pure_delete(db):
    """The backfill is a command, run before migrate, not work done inside 0003.

    Distilling a run reads its GeoPackage and a crosswalk of tens of thousands of rows.
    Inside the migration that runs during `tethys db migrate` in the entrypoint, with no
    progress output and no bound, and a container that never serves if it fails.
    """
    from importlib import import_module

    module = import_module("tethysapp.ngiab.migrations.0003_delete_modelrun".replace("0003", "0003"))
    operations = module.Migration.operations
    assert len(operations) == 1
    assert type(operations[0]).__name__ == "DeleteModel"
