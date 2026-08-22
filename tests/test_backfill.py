"""Backfilling manifests for runs the database still registers.

Read docs/plans/2026-08-22-001-feat-storage-backed-model-runs-plan.md, Unit 7.

This is the only unit that touches data a user already has. Everything before it added code
paths; this one reads rows somebody's laptop has been accumulating since August and has to
turn them into manifests without losing any of them. The tests are written against that
standard rather than against a fresh database -- a fresh database is the case that cannot go
wrong.

Rows are inserted with raw SQL here for the same reason the command reads them that way: the
model disappears in Unit 8, and a test that depended on it would stop compiling exactly when
the behaviour it covers still matters.
"""

import os
import uuid

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection

from tethysapp.ngiab import manifest, run_store
from tethysapp.ngiab.management.commands import backfill_manifests

TABLE = backfill_manifests.REGISTRY_TABLE


def _insert(path, label="a run", run_id=None, teehr="", created="2026-08-01 00:00:00"):
    """Add a registry row the way the ORM would have, undashed uuid included."""
    run_id = (run_id or str(uuid.uuid4())).replace("-", "")
    with connection.cursor() as cursor:
        cursor.execute(
            f"INSERT INTO {TABLE} (id, label, path, subset, tags, "  # noqa: S608
            f"teehr_configuration_name, created) VALUES (%s, %s, %s, '', '[]', %s, %s)",
            [run_id, label, path, teehr, created],
        )
    return run_id


@pytest.fixture
def registry(db, tmp_path, monkeypatch):
    """A storage root and an empty registry table, as an upgrading install would have."""
    root = tmp_path / "ngiab_visualizer"
    root.mkdir()
    monkeypatch.delenv(run_store.duckdb_conn.STORAGE_BACKEND_ENV, raising=False)
    monkeypatch.setenv(run_store.MANAGED_ROOT_ENV, str(root))
    monkeypatch.setenv(run_store.LISTING_TTL_ENV, "0")
    run_store.clear_caches()
    return root


@pytest.fixture
def run_in_root(registry, mini_run_factory):
    def make(name):
        source = mini_run_factory(name=f"src-{name}")
        destination = registry / name
        os.rename(source, destination)
        return str(destination)

    return make


# ---- The ordinary upgrade ---------------------------------------------------


def test_each_registered_directory_gets_a_manifest(registry, run_in_root):
    alpha, beta = run_in_root("alpha"), run_in_root("beta")
    _insert(alpha, label="alpha")
    _insert(beta, label="beta")

    call_command("backfill_manifests")

    assert manifest.read(alpha)["label"] == "alpha"
    assert manifest.read(beta)["label"] == "beta"


def test_the_run_becomes_visible_to_the_listing(registry, run_in_root):
    """The point of the exercise: a registered row becomes a listed run."""
    _insert(run_in_root("alpha"), label="alpha")
    call_command("backfill_manifests")
    run_store.clear_caches()

    assert [entry["name"] for entry in run_store.list_runs()] == ["alpha"]


def test_rerunning_changes_nothing(registry, run_in_root):
    """The entrypoint runs this on every start."""
    alpha = run_in_root("alpha")
    _insert(alpha, label="alpha")

    call_command("backfill_manifests")
    with open(os.path.join(alpha, manifest.MANIFEST_NAME)) as handle:
        first = handle.read()

    call_command("backfill_manifests")
    with open(os.path.join(alpha, manifest.MANIFEST_NAME)) as handle:
        assert handle.read() == first


def test_created_is_carried_across(registry, run_in_root):
    """Losing it would change which run the picker selects by default."""
    alpha = run_in_root("alpha")
    _insert(alpha, label="alpha", created="2026-08-05 12:00:00")
    call_command("backfill_manifests")

    assert manifest.read(alpha)["created"].startswith("2026-08-05")


def test_teehr_configuration_name_is_carried_across(registry, run_in_root):
    """It was captured from the producer's manifest at registration, and can outlive it.

    distill reads this from teehr_run_manifest.json inside the run. A run whose producer
    manifest was removed, or which was registered by hand, has nowhere for distill to read it
    from -- so the registry row is the only copy, and dropping it here loses the one TEEHR
    fact this app cannot re-derive from the directory.

    Caught by an end-to-end check in the container, not by this test, which originally
    asserted `in ("ngen_alpha", "")` and so could not fail.
    """
    alpha = run_in_root("alpha")
    assert not os.path.exists(os.path.join(alpha, "teehr_run_manifest.json"))
    _insert(alpha, label="alpha", teehr="ngen_alpha")
    call_command("backfill_manifests")

    assert manifest.read(alpha)["teehr"]["configuration_name"] == "ngen_alpha"


def test_the_producer_manifest_still_wins_over_the_registry_row(registry, run_in_root):
    """The producer's own file is authoritative; the row is a fallback, not an override."""
    import json as _json

    alpha = run_in_root("alpha")
    with open(os.path.join(alpha, "teehr_run_manifest.json"), "w") as handle:
        _json.dump({"teehr_configuration_name": "ngen_from_producer"}, handle)
    _insert(alpha, label="alpha", teehr="ngen_from_row")

    call_command("backfill_manifests")
    assert manifest.read(alpha)["teehr"]["configuration_name"] == "ngen_from_producer"


# ---- R14: several rows, one directory ---------------------------------------


def test_every_uuid_on_a_shared_directory_survives(registry, run_in_root):
    """ModelRun.path was deliberately not unique -- once per import, says its own comment.

    Collapsing N rows onto one manifest with a single legacy id would resolve one share link
    and silently break the rest.
    """
    alpha = run_in_root("alpha")
    first = _insert(alpha, label="alpha")
    second = _insert(alpha, label="alpha again")

    call_command("backfill_manifests")

    stored = manifest.read(alpha)["legacy_uuids"]
    assert set(stored) == {first, second}


def test_both_uuids_resolve_after_the_backfill(registry, run_in_root):
    """End to end: a link minted against either row still finds the run."""
    from tethysapp.ngiab import utils as ngiab_utils

    alpha = run_in_root("alpha")
    first = _insert(alpha, label="alpha")
    second = _insert(alpha, label="alpha again")
    call_command("backfill_manifests")
    run_store.clear_caches()

    assert ngiab_utils._get_model_run_path_by_id(first) == alpha
    assert ngiab_utils._get_model_run_path_by_id(second) == alpha


def test_an_existing_manifest_gains_ids_rather_than_losing_them(registry, run_in_root):
    """A re-run must never narrow what is known about a run."""
    alpha = run_in_root("alpha")
    manifest.write(
        alpha,
        manifest.distill(alpha, label="alpha", legacy_uuids=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]),
    )
    fresh = _insert(alpha, label="alpha")

    call_command("backfill_manifests")

    stored = set(manifest.read(alpha)["legacy_uuids"])
    assert "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" in stored
    assert fresh in stored


# ---- The cases that lose data if handled badly ------------------------------


def test_a_directory_outside_the_storage_root_is_reported_not_dropped(
    registry, mini_run_factory, tmp_path, capsys
):
    """The common upgrade case, not the exotic one.

    NGIAB_SCAN_ROOTS exists so a deployment can register runs from other mounts, so an
    upgrading install may well have several. Once the registry is dropped, a directory
    outside the root is a run that simply stops appearing -- so it is named, with the path
    and what to do about it.
    """
    outside = mini_run_factory(name="elsewhere")
    _insert(outside, label="elsewhere")

    call_command("backfill_manifests")

    captured = capsys.readouterr()
    assert "outside the storage root" in captured.err
    assert outside in captured.err
    assert not os.path.exists(os.path.join(outside, manifest.MANIFEST_NAME))


def test_a_missing_directory_is_reported_and_does_not_abort_the_rest(
    registry, run_in_root, capsys
):
    alpha = run_in_root("alpha")
    _insert(alpha, label="alpha")
    _insert(str(registry / "gone"), label="gone")

    call_command("backfill_manifests")

    assert "no longer exists" in capsys.readouterr().err
    assert manifest.read(alpha) is not None


def test_one_undistillable_run_does_not_lose_the_others(
    registry, run_in_root, monkeypatch, capsys
):
    alpha, beta = run_in_root("alpha"), run_in_root("beta")
    _insert(alpha, label="alpha")
    _insert(beta, label="beta")

    real = manifest.distill

    def explode(path, **kwargs):
        if path.endswith("alpha"):
            raise RuntimeError("bad gpkg")
        return real(path, **kwargs)

    monkeypatch.setattr(manifest, "distill", explode)
    call_command("backfill_manifests")

    assert "could not distil" in capsys.readouterr().err
    assert manifest.read(beta) is not None


def test_an_unwritable_root_aborts_rather_than_half_finishing(
    registry, run_in_root, monkeypatch
):
    """Continuing here would let Unit 8 drop the table with nothing written to replace it."""
    _insert(run_in_root("alpha"), label="alpha")

    def refuse(path, document):
        raise OSError("read-only file system")

    monkeypatch.setattr(manifest, "write", refuse)
    with pytest.raises(CommandError) as excinfo:
        call_command("backfill_manifests")
    assert "would lose these runs" in str(excinfo.value)


# ---- Before and after the table exists --------------------------------------


def test_no_registry_table_is_not_an_error(registry, monkeypatch):
    """After Unit 8 the table is gone and this still runs on every start."""
    monkeypatch.setattr(
        connection.introspection, "table_names", lambda *a, **k: ["auth_user"]
    )
    call_command("backfill_manifests")


def test_an_empty_registry_is_not_an_error(registry):
    call_command("backfill_manifests")


def test_dry_run_writes_nothing(registry, run_in_root):
    alpha = run_in_root("alpha")
    _insert(alpha, label="alpha")
    call_command("backfill_manifests", "--dry-run")
    assert manifest.read(alpha) is None


def test_the_command_does_not_import_the_model(registry):
    """It has to outlive models.py, which Unit 8 deletes.

    An operator upgrading from a pre-manifest image straight to a post-removal one is exactly
    the person who needs this to work, and an ImportError would lose every registration they
    had in the one upgrade path that cannot be retried.
    """
    source = os.path.join(
        os.path.dirname(backfill_manifests.__file__), "backfill_manifests.py"
    )
    with open(source) as handle:
        text = handle.read()
    assert "from .models" not in text
    assert "import ModelRun" not in text
