"""Backfilling manifests for runs the database still registers, without losing any of them.
Rows are inserted with raw SQL since the model that reads them disappears in a later migration."""

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


def _create_legacy_table():
    """Recreate the table migration 0003 drops."""
    with connection.cursor() as cursor:
        cursor.execute(
            f"""CREATE TABLE IF NOT EXISTS {TABLE} (
                id char(32) NOT NULL PRIMARY KEY,
                label varchar(255) NOT NULL,
                path varchar(1024) NOT NULL,
                subset varchar(255) NOT NULL,
                tags text NOT NULL,
                teehr_configuration_name varchar(255) NOT NULL,
                created datetime NOT NULL
            )"""
        )


@pytest.fixture
def registry(db, tmp_path, monkeypatch):
    """A storage root and a legacy registry table, as an upgrading install would have."""
    _create_legacy_table()
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
    """It was captured from the producer's manifest at registration, and can outlive it."""
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


def test_every_uuid_on_a_shared_directory_survives(registry, run_in_root):
    """ModelRun.path was deliberately not unique -- once per import, says its own comment."""
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


def test_a_directory_outside_the_storage_root_is_reported_not_dropped(
    registry, mini_run_factory, tmp_path, capsys
):
    """A directory outside the storage root is reported by name, not silently dropped."""
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


def test_no_registry_table_is_not_an_error(db, tmp_path, monkeypatch):
    """The steady state after the migration: the table is gone and this still runs."""
    monkeypatch.setenv(run_store.MANAGED_ROOT_ENV, str(tmp_path))
    with connection.cursor() as cursor:
        cursor.execute(f"DROP TABLE IF EXISTS {TABLE}")
    call_command("backfill_manifests")


def test_an_empty_registry_is_not_an_error(registry):
    call_command("backfill_manifests")


def test_dry_run_writes_nothing(registry, run_in_root):
    alpha = run_in_root("alpha")
    _insert(alpha, label="alpha")
    call_command("backfill_manifests", "--dry-run")
    assert manifest.read(alpha) is None


def test_the_command_does_not_import_the_model(registry):
    """The backfill command must not import the ORM model, which a later migration deletes."""
    source = os.path.join(
        os.path.dirname(backfill_manifests.__file__), "backfill_manifests.py"
    )
    with open(source) as handle:
        text = handle.read()
    assert "from .models" not in text
    assert "import ModelRun" not in text


def test_a_row_whose_path_is_stale_is_found_by_name_in_the_root(registry, run_in_root):
    """A registry row can point somewhere that does not exist inside the container."""
    alpha = run_in_root("alpha")
    stale = "/somewhere/that/never/existed/alpha"
    original = _insert(stale, label="alpha")

    call_command("backfill_manifests")

    assert manifest.read(alpha) is not None
    assert original in manifest.read(alpha)["legacy_uuids"]


def test_a_correct_path_still_wins(registry, run_in_root, mini_run_factory):
    """A deployment whose paths resolve must not be redirected by name matching."""
    alpha = run_in_root("alpha")
    _insert(alpha, label="alpha")
    call_command("backfill_manifests")
    assert manifest.read(alpha) is not None


def test_a_row_matching_nothing_is_still_reported_missing(registry, capsys):
    """Name matching must not turn a genuinely absent run into a silent success."""
    _insert("/gone/entirely/nowhere-run", label="nowhere-run")
    call_command("backfill_manifests")
    assert "no longer exists" in capsys.readouterr().err
