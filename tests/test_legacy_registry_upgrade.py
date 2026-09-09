"""Upgrading from the pre-manifest release keeps the run's name and its shared links.

The earlier version kept its registry in ngiab_visualizer.json at the storage root. Nothing
reads that file now, and the picker tells an operator to run write_manifest -- which, taken
literally, named the run after its directory and dropped the uuid its links were shared
under. Both still sit in the JSON beside the run, so the command reads them.
"""

import json
import os

from django.core.management import call_command

from tethysapp.ngiab import manifest


def _legacy_registry(root, run_dir, run_id, label):
    document = {"model_runs": [{"id": run_id, "label": label, "path": run_dir}]}
    with open(os.path.join(root, "ngiab_visualizer.json"), "w") as handle:
        json.dump(document, handle)


def test_the_label_and_shared_link_survive_the_upgrade(ingest, monkeypatch):
    run_id = ingest()
    run_dir = os.path.join(ingest.root, run_id)
    legacy_uuid = "6f1c9d2e-77aa-4b31-9f0e-2c5d8a1b4e77"
    _legacy_registry(ingest.root, run_dir, legacy_uuid, "Hurricane Ida, 2021")
    os.remove(os.path.join(run_dir, manifest.MANIFEST_NAME))

    call_command("write_manifest", "--path", run_dir)

    document = manifest.read(run_dir)
    assert document["label"] == "Hurricane Ida, 2021"
    assert manifest.normalize_uuid(legacy_uuid) in document["legacy_uuids"]


def test_an_explicit_label_still_wins(ingest):
    run_id = ingest()
    run_dir = os.path.join(ingest.root, run_id)
    _legacy_registry(ingest.root, run_dir, "1111", "from the json")
    os.remove(os.path.join(run_dir, manifest.MANIFEST_NAME))

    call_command("write_manifest", "--path", run_dir, "--label", "chosen by hand")

    assert manifest.read(run_dir)["label"] == "chosen by hand"


def test_no_registry_file_is_not_an_error(ingest):
    run_id = ingest()
    run_dir = os.path.join(ingest.root, run_id)
    os.remove(os.path.join(run_dir, manifest.MANIFEST_NAME))

    call_command("write_manifest", "--path", run_dir)

    assert manifest.read(run_dir)["label"] == os.path.basename(run_dir)
