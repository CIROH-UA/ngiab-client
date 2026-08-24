"""An uploaded archive is the first wholesale user input this app takes.
These tests attack it rather than merely cover it."""

import io
import os
import tarfile
import zipfile

import pytest

from tethysapp.ngiab import archive


def _run_files():
    """The minimum an archive needs to be accepted as a run."""
    return {
        "myrun/config/realization.json": b'{"time": {}}',
        "myrun/outputs/ngen/cat-100.csv": b"Time,Q_OUT\n2017-01-01,1.0\n",
    }


def write_tar(path, files, *, mode="w"):
    with tarfile.open(path, mode) as handle:
        for name, payload in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            handle.addfile(info, io.BytesIO(payload))
    return str(path)


def write_zip(path, files):
    with zipfile.ZipFile(path, "w") as handle:
        for name, payload in files.items():
            handle.writestr(name, payload)
    return str(path)


@pytest.mark.parametrize("evil", [
    "../../etc/cron.d/pwn",
    "/etc/cron.d/pwn",
    "myrun/../../../tmp/pwn",
    "myrun/./../../pwn",
])
def test_a_traversing_member_is_refused_in_tar(tmp_path, evil):
    files = _run_files()
    files[evil] = b"x"
    path = write_tar(tmp_path / "a.tar", files)
    with pytest.raises(archive.ArchiveRejected, match="unsafe path"):
        archive.inspect(path)


@pytest.mark.parametrize("evil", [
    "../../etc/cron.d/pwn",
    "/etc/cron.d/pwn",
    "myrun/../../pwn",
])
def test_a_traversing_member_is_refused_in_zip(tmp_path, evil):
    files = _run_files()
    files[evil] = b"x"
    path = write_zip(tmp_path / "a.zip", files)
    with pytest.raises(archive.ArchiveRejected, match="unsafe path"):
        archive.inspect(path)


def test_a_windows_absolute_path_is_refused(tmp_path):
    files = _run_files()
    files["C:/windows/system32/evil"] = b"x"
    with pytest.raises(archive.ArchiveRejected, match="unsafe path"):
        archive.inspect(write_zip(tmp_path / "a.zip", files))


def test_a_symlink_member_is_refused(tmp_path):
    """A symlink can redirect a later member's write after containment was checked."""
    path = tmp_path / "a.tar"
    with tarfile.open(path, "w") as handle:
        for name, payload in _run_files().items():
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            handle.addfile(info, io.BytesIO(payload))
        link = tarfile.TarInfo("myrun/escape")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc"
        handle.addfile(link)

    with pytest.raises(archive.ArchiveRejected, match="link"):
        archive.inspect(str(path))


def test_a_hardlink_member_is_refused(tmp_path):
    path = tmp_path / "a.tar"
    with tarfile.open(path, "w") as handle:
        for name, payload in _run_files().items():
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            handle.addfile(info, io.BytesIO(payload))
        link = tarfile.TarInfo("myrun/hard")
        link.type = tarfile.LNKTYPE
        link.linkname = "myrun/config/realization.json"
        handle.addfile(link)

    with pytest.raises(archive.ArchiveRejected, match="link"):
        archive.inspect(str(path))


def test_nothing_lands_outside_the_destination(tmp_path):
    """The claim that matters, asserted against the filesystem rather than the exception."""
    outside = tmp_path / "outside"
    outside.mkdir()
    dest = tmp_path / "dest"

    files = _run_files()
    files["../outside/pwn"] = b"x"
    path = write_tar(tmp_path / "a.tar", files)

    with pytest.raises(archive.ArchiveRejected):
        archive.extract(path, str(dest))
    assert os.listdir(outside) == []


def test_a_declared_size_over_the_cap_is_refused(tmp_path):
    files = _run_files()
    files["myrun/outputs/big"] = b"0" * 4096
    path = write_tar(tmp_path / "a.tar", files)
    with pytest.raises(archive.ArchiveRejected, match="unpacks to more than"):
        archive.inspect(path, max_bytes=1024)


def test_a_member_count_over_the_cap_is_refused(tmp_path):
    files = _run_files()
    for i in range(50):
        files[f"myrun/outputs/ngen/cat-{i}.csv"] = b"x"
    path = write_tar(tmp_path / "a.tar", files)
    with pytest.raises(archive.ArchiveRejected, match="more than"):
        archive.inspect(path, max_members=10)


def test_a_zip_that_lies_about_its_size_is_stopped_while_writing(tmp_path):
    """The declared size is a claim; the running total during extraction is the fact."""
    path = tmp_path / "a.zip"
    files = _run_files()
    files["myrun/outputs/bomb"] = b"0" * 200_000
    write_zip(path, files)
    with pytest.raises(archive.ArchiveRejected, match="unpacks to more than"):
        archive.extract(str(path), str(tmp_path / "dest"), max_bytes=50_000)


def test_an_archive_with_no_realization_is_refused(tmp_path):
    path = write_tar(tmp_path / "a.tar", {"myrun/outputs/ngen/cat-100.csv": b"x"})
    with pytest.raises(archive.ArchiveRejected, match="realization.json"):
        archive.inspect(path)


def test_an_archive_with_no_outputs_is_refused(tmp_path):
    path = write_tar(tmp_path / "a.tar", {"myrun/config/realization.json": b"{}"})
    with pytest.raises(archive.ArchiveRejected, match="outputs/"):
        archive.inspect(path)


def test_an_empty_archive_is_refused(tmp_path):
    with pytest.raises(archive.ArchiveRejected, match="empty"):
        archive.inspect(write_tar(tmp_path / "a.tar", {}))


def test_something_that_is_not_an_archive_is_refused(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_text("this is not an archive")
    with pytest.raises(archive.ArchiveRejected, match="neither a tar nor a zip"):
        archive.inspect(str(path))


def test_the_kind_is_sniffed_not_taken_from_the_name(tmp_path):
    """The filename comes from the same person as the bytes."""
    path = tmp_path / "run.zip"
    write_tar(path, _run_files())
    root, entries = archive.inspect(str(path))
    assert root == "myrun"


def test_a_tar_run_extracts(tmp_path):
    path = write_tar(tmp_path / "a.tar", _run_files())
    unpacked = archive.extract(path, str(tmp_path / "dest"))
    assert os.path.isfile(os.path.join(unpacked, "config", "realization.json"))
    assert os.path.isfile(os.path.join(unpacked, "outputs", "ngen", "cat-100.csv"))


def test_a_gzipped_tar_run_extracts(tmp_path):
    path = write_tar(tmp_path / "a.tar.gz", _run_files(), mode="w:gz")
    unpacked = archive.extract(path, str(tmp_path / "dest"))
    assert os.path.isfile(os.path.join(unpacked, "config", "realization.json"))


def test_a_zip_run_extracts(tmp_path):
    path = write_zip(tmp_path / "a.zip", _run_files())
    unpacked = archive.extract(path, str(tmp_path / "dest"))
    assert os.path.isfile(os.path.join(unpacked, "outputs", "ngen", "cat-100.csv"))


def test_a_run_archived_without_a_top_level_directory_works(tmp_path):
    """`cd myrun && zip -r ../run.zip .` is at least as common as archiving the directory."""
    flat = {
        "config/realization.json": b"{}",
        "outputs/ngen/cat-100.csv": b"Time,Q_OUT\n",
    }
    unpacked = archive.extract(write_zip(tmp_path / "a.zip", flat), str(tmp_path / "d"))
    assert os.path.isfile(os.path.join(unpacked, "config", "realization.json"))


class _Usage:
    def __init__(self, free):
        self.free = free


def test_free_space_is_measured_from_the_nearest_existing_parent(tmp_path, monkeypatch):
    """The destination does not exist yet, so measuring it directly would raise."""
    asked = []

    def fake(path):
        asked.append(path)
        return _Usage(free=100 * 1024 ** 3)

    monkeypatch.setattr(archive.shutil, "disk_usage", fake)
    archive.usable_bytes(str(tmp_path / "not" / "created" / "yet"))
    assert asked == [str(tmp_path)]


def test_headroom_is_held_back_rather_than_offering_the_last_byte(monkeypatch):
    monkeypatch.setattr(archive.shutil, "disk_usage", lambda _p: _Usage(free=100 * 1024 ** 3))
    usable = archive.usable_bytes("/")
    assert usable == 90 * 1024 ** 3


def test_a_nearly_full_disk_offers_nothing_rather_than_a_negative_cap(monkeypatch):
    monkeypatch.setattr(archive.shutil, "disk_usage", lambda _p: _Usage(free=1024))
    assert archive.usable_bytes("/") == 0


def test_an_unmeasurable_disk_leaves_the_ceiling_alone(monkeypatch):
    def refuse(_path):
        raise OSError("no statvfs here")

    monkeypatch.setattr(archive.shutil, "disk_usage", refuse)
    assert archive.usable_bytes("/") is None


def test_an_archive_larger_than_the_free_disk_is_refused_before_anything_is_written(
    tmp_path, monkeypatch
):
    """Without this the disk fills mid-extract and the caller gets OSError and a partial run."""
    files = _run_files()
    files["myrun/outputs/big"] = b"0" * 200_000
    path = write_tar(tmp_path / "a.tar", files)
    destination = tmp_path / "dest"

    monkeypatch.setattr(archive, "usable_bytes", lambda _d: 1024)
    with pytest.raises(archive.ArchiveRejected, match="free space"):
        archive.extract(path, str(destination))

    assert not destination.exists()


def test_the_disk_only_lowers_the_ceiling_it_never_raises_it(tmp_path, monkeypatch):
    """A roomy disk must not license an archive the caller's own cap already refuses."""
    files = _run_files()
    files["myrun/outputs/big"] = b"0" * 200_000
    path = write_tar(tmp_path / "a.tar", files)

    monkeypatch.setattr(archive, "usable_bytes", lambda _d: 500 * 1024 ** 3)
    with pytest.raises(archive.ArchiveRejected) as raised:
        archive.extract(path, str(tmp_path / "dest"), max_bytes=1024)
    assert "free space" not in str(raised.value)


def test_a_roomy_disk_does_not_disturb_an_ordinary_extraction(tmp_path, monkeypatch):
    path = write_tar(tmp_path / "a.tar", _run_files())
    monkeypatch.setattr(archive, "usable_bytes", lambda _d: 500 * 1024 ** 3)
    unpacked = archive.extract(path, str(tmp_path / "dest"))
    assert os.path.isfile(os.path.join(unpacked, "config", "realization.json"))


def test_an_unread_tree_is_left_in_the_tar(tmp_path):
    files = _run_files()
    files["myrun/forcings/big.nc"] = b"0" * 5000
    files["myrun/restart/state.nc"] = b"0" * 5000
    path = write_tar(tmp_path / "a.tar", files)

    unpacked = archive.extract(path, str(tmp_path / "dest"), skip=archive.UNREAD_DIRS)

    assert os.path.isfile(os.path.join(unpacked, "outputs", "ngen", "cat-100.csv"))
    assert not os.path.exists(os.path.join(unpacked, "forcings"))
    assert not os.path.exists(os.path.join(unpacked, "restart"))


def test_an_unread_tree_is_left_in_the_zip(tmp_path):
    files = _run_files()
    files["myrun/forcings/big.nc"] = b"0" * 5000
    path = write_zip(tmp_path / "a.zip", files)

    unpacked = archive.extract(str(path), str(tmp_path / "dest"), skip=archive.UNREAD_DIRS)

    assert os.path.isfile(os.path.join(unpacked, "config", "realization.json"))
    assert not os.path.exists(os.path.join(unpacked, "forcings"))


def test_a_skipped_tree_is_not_charged_against_the_cap(tmp_path):
    """Charging a run for bytes that never reach the disk would refuse runs that fit."""
    files = _run_files()
    files["myrun/forcings/big.nc"] = b"0" * 200_000
    path = write_tar(tmp_path / "a.tar", files)

    with pytest.raises(archive.ArchiveRejected, match="unpacks to more than"):
        archive.inspect(path, max_bytes=50_000)

    root, _ = archive.inspect(path, max_bytes=50_000, skip=archive.UNREAD_DIRS)
    assert root == "myrun"


def test_skipping_does_not_excuse_an_unsafe_path_inside_the_skipped_tree(tmp_path):
    """A refusal is about the archive, not about which parts this caller wanted."""
    files = _run_files()
    files["myrun/forcings/../../../etc/pwn"] = b"x"
    path = write_tar(tmp_path / "a.tar", files)

    with pytest.raises(archive.ArchiveRejected, match="unsafe path"):
        archive.inspect(path, skip=archive.UNREAD_DIRS)


def test_a_directory_named_like_an_unread_tree_deeper_in_the_run_is_kept(tmp_path):
    """The names are top-level trees, not a substring match on every path."""
    files = _run_files()
    files["myrun/outputs/forcings/keep.csv"] = b"a,b\n1,2\n"
    path = write_tar(tmp_path / "a.tar", files)

    unpacked = archive.extract(path, str(tmp_path / "dest"), skip=archive.UNREAD_DIRS)
    assert os.path.isfile(os.path.join(unpacked, "outputs", "forcings", "keep.csv"))


def test_a_rootless_archive_still_has_its_unread_trees_skipped(tmp_path):
    files = {
        "config/realization.json": b'{"time": {}}',
        "outputs/ngen/cat-100.csv": b"Time,Q_OUT\n2017-01-01,1.0\n",
        "forcings/big.nc": b"0" * 5000,
    }
    path = write_tar(tmp_path / "a.tar", files)

    unpacked = archive.extract(path, str(tmp_path / "dest"), skip=archive.UNREAD_DIRS)
    assert os.path.isfile(os.path.join(unpacked, "outputs", "ngen", "cat-100.csv"))
    assert not os.path.exists(os.path.join(unpacked, "forcings"))


def test_a_nested_unread_tree_is_left_in_the_archive(tmp_path):
    """cat_config sits under config/, which is otherwise kept in full."""
    files = _run_files()
    files["myrun/config/cat_config/NOAH-OWP-M/cat-100.input"] = b"x"
    files["myrun/config/mini.gpkg"] = b"gpkg"
    path = write_tar(tmp_path / "a.tar", files)

    unpacked = archive.extract(path, str(tmp_path / "dest"), skip=archive.UNREAD_DIRS)

    assert os.path.isfile(os.path.join(unpacked, "config", "realization.json"))
    assert os.path.isfile(os.path.join(unpacked, "config", "mini.gpkg"))
    assert not os.path.exists(os.path.join(unpacked, "config", "cat_config"))


def test_a_tree_whose_name_only_starts_the_same_is_kept(tmp_path):
    """Matching is on whole segments, not on the string the name begins with."""
    files = _run_files()
    files["myrun/config/cat_config_notes/readme.txt"] = b"x"
    files["myrun/forcings_summary.txt"] = b"x"
    path = write_tar(tmp_path / "a.tar", files)

    unpacked = archive.extract(path, str(tmp_path / "dest"), skip=archive.UNREAD_DIRS)

    assert os.path.isfile(os.path.join(unpacked, "config", "cat_config_notes", "readme.txt"))
    assert os.path.isfile(os.path.join(unpacked, "forcings_summary.txt"))
