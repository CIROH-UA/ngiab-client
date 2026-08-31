"""The defects a code review found in the upload path, each pinned by the attack that proved it."""

import csv
import io
import json
import os
import tarfile

import pytest
from django.core.management import call_command

from tethysapp.ngiab import archive, duckdb_conn, manifest, run_store


def _run_with_header(tmp_path, columns, name="attack"):
    run = tmp_path / name
    outputs = run / "outputs" / "ngen"
    outputs.mkdir(parents=True)
    (run / "config").mkdir()
    (run / "config" / "realization.json").write_text("{}")
    with open(outputs / "cat-100.csv", "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(columns)
        writer.writerow([0, "2017-01-01 00:00:00", 1.0])
    return str(run)


def test_a_csv_header_cannot_execute_sql(tmp_path):
    """A csv header crafted as SQL must not execute on the shared, credential-holding connection."""
    evil = 'Q_OUT" AS orig, (SELECT 31337) AS pwned, "Time'
    run = _run_with_header(tmp_path, ["Time Step", "Time", evil])

    call_command("convert_outputs", "--path", run)

    parquet = os.path.join(run, "outputs", "ngen", "catchments-0.parquet")
    columns = [
        str(c)
        for c in duckdb_conn.query(
            f"SELECT * FROM read_parquet({duckdb_conn.quote(parquet)}) LIMIT 0"
        ).columns
    ]
    assert "pwned" not in columns
    assert evil in columns, "the header should survive as a literal column name"


def test_a_quote_in_a_column_name_is_doubled_not_terminated(tmp_path):
    run = _run_with_header(tmp_path, ["Time Step", "Time", 'a"b'])
    call_command("convert_outputs", "--path", run)

    parquet = os.path.join(run, "outputs", "ngen", "catchments-0.parquet")
    columns = [
        str(c)
        for c in duckdb_conn.query(
            f"SELECT * FROM read_parquet({duckdb_conn.quote(parquet)}) LIMIT 0"
        ).columns
    ]
    assert 'a"b' in columns


def test_quote_identifier_doubles_embedded_quotes():
    assert duckdb_conn.quote_identifier('a"b') == '"a""b"'
    assert duckdb_conn.quote_identifier("plain") == '"plain"'


def test_a_malicious_header_cannot_reach_the_read_path(tmp_path, monkeypatch):
    """The same pattern was in the readers, reachable on an un-consolidated run."""
    from tethysapp.ngiab import utils as ngiab_utils

    evil = 'Q_OUT" , (SELECT 1) AS pwned, "Time'
    run = _run_with_header(tmp_path, ["Time Step", "Time", evil], name="unconsolidated")
    monkeypatch.setenv(run_store.MANAGED_ROOT_ENV, str(tmp_path))
    manifest.write(run, manifest.distill(run, run_id="unconsolidated", label="x"))
    run_store.clear_caches()
    manifest.clear_caches()

    columns = ngiab_utils._read_output_columns(
        ngiab_utils.run_outputs("unconsolidated"), "cat-100"
    )
    assert evil in columns
    assert "pwned" not in columns


@pytest.mark.parametrize("payload", [
    "../../../../../../etc",
    "../../victim/ngen",
    "/etc/passwd",
    "..",
])
def test_output_root_cannot_leave_the_run(tmp_path, payload):
    """Verified exploit: '../../../../../../etc' resolved to /etc and was served openly."""
    run = tmp_path / "attacker"
    (run / "config").mkdir(parents=True)
    (run / "config" / "realization.json").write_text(json.dumps({"output_root": payload}))

    relative = manifest._read_realization_output_dir(str(run))
    resolved = os.path.normpath(os.path.join(str(run), relative))
    assert resolved == str(run) or resolved.startswith(str(run) + os.sep), resolved


def test_an_ordinary_output_root_still_works(tmp_path):
    run = tmp_path / "ordinary"
    (run / "config").mkdir(parents=True)
    (run / "config" / "realization.json").write_text(
        json.dumps({"output_root": "./outputs/ngen"})
    )
    assert manifest._read_realization_output_dir(str(run)) == "outputs/ngen"


@pytest.mark.parametrize("stored", ["outputs/../../../etc", "/etc", "../.."])
def test_a_manifest_already_holding_an_escape_is_contained_on_read(stored):
    """Manifests written before the fix still carry the bad value, so the read path guards too."""
    assert manifest.contained_output_dir(stored) == "outputs/ngen"


def _tar_with_special(path, kind):
    with tarfile.open(path, "w") as handle:
        for name, payload in {
            "myrun/config/realization.json": b"{}",
            "myrun/outputs/ngen/cat-100.csv": b"Time,Q_OUT\n",
        }.items():
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            handle.addfile(info, io.BytesIO(payload))
        special = tarfile.TarInfo(f"myrun/{kind}")
        special.type = {"chardev": tarfile.CHRTYPE, "blockdev": tarfile.BLKTYPE,
                        "fifo": tarfile.FIFOTYPE}[kind]
        special.devmajor, special.devminor = 1, 3
        handle.addfile(special)
    return str(path)


@pytest.mark.parametrize("kind", ["chardev", "blockdev", "fifo"])
def test_a_device_or_fifo_member_is_refused_as_archive_rejected(tmp_path, kind):
    """A device or fifo archive member is refused as ArchiveRejected, not an unhandled exception."""
    path = _tar_with_special(tmp_path / "a.tar", kind)

    with pytest.raises(archive.ArchiveRejected, match="link or device node"):
        archive.inspect(path)
    with pytest.raises(archive.ArchiveRejected):
        archive.extract(path, str(tmp_path / "dest"))


def test_the_member_cap_is_not_off_by_one(tmp_path):
    files = {"myrun/config/realization.json": b"{}",
             "myrun/outputs/ngen/cat-100.csv": b"x"}
    for i in range(20):
        files[f"myrun/outputs/ngen/cat-{i}.csv"] = b"x"
    with tarfile.open(tmp_path / "a.tar", "w") as handle:
        for name, payload in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            handle.addfile(info, io.BytesIO(payload))

    with pytest.raises(archive.ArchiveRejected, match="more than 5 entries"):
        archive.inspect(str(tmp_path / "a.tar"), max_members=5)


def test_the_sidecar_cache_keys_on_the_token_it_is_given():
    """The sidecar cache keys on the version token it is given, not on a filesystem open()."""
    calls = []
    real = manifest._catchments_cached

    def spy(run_path, version_token):
        calls.append(version_token)
        return {}

    manifest._catchments_cached = spy
    try:
        manifest.catchments("s3://bucket/prefix/run", "token-abc")
        manifest.catchment_group("s3://bucket/prefix/run", "cat-1", "token-abc")
    finally:
        manifest._catchments_cached = real

    assert calls == ["token-abc", "token-abc"], "the supplied token must reach the cache key"


def test_a_reingested_hosted_run_is_not_served_from_the_old_cache(ingest):
    """The behaviour the token exists for, asserted through the public readers."""
    run_id = ingest("alpha")
    first = set(__import__("tethysapp.ngiab.utils", fromlist=["x"]).getCatchmentsList(run_id))
    assert first

    document = manifest.read(str(ingest.root / run_id))
    assert document["version_token"], "a distilled run must carry a token"
