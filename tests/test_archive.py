"""An uploaded archive is the first wholesale user input this app takes.

Every other input is a name the listing just produced, or a path an operator placed. Here the
bytes decide what gets written, where, how many times and how large. These tests are written
as attacks rather than as coverage, because the interesting cases are the ones a well-formed
archive never exercises.
"""

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
