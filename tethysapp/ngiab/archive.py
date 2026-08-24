"""Unpack an uploaded run archive, refusing everything that is not a run.

Refuses special files, escaping paths, unbounded expansion, and archives that are not runs.
"""

import logging
import os
import posixpath
import tarfile
import zipfile

logger = logging.getLogger(__name__)

DEFAULT_MAX_BYTES = 32 * 1024 * 1024 * 1024

DEFAULT_MAX_MEMBERS = 500_000

REALIZATION = "realization.json"
REQUIRED_DIRS = ("outputs",)


class ArchiveRejected(ValueError):
    """The archive is malformed, unsafe, or not a model run."""


def _members_tar(handle):
    for info in handle.getmembers():
        special = info.issym() or info.islnk() or info.isdev()
        yield info.name, info.size, info.isdir(), special


def _members_zip(handle):
    for info in handle.infolist():
        yield info.filename, info.file_size, info.is_dir(), False


def open_archive(path):
    """Open ``path`` as tar or zip, whichever it is, or refuse it."""
    if tarfile.is_tarfile(path):
        return tarfile.open(path, "r:*"), _members_tar, "tar"
    if zipfile.is_zipfile(path):
        return zipfile.ZipFile(path), _members_zip, "zip"
    raise ArchiveRejected(
        "That file is neither a tar nor a zip archive. Upload the run as .tar, .tar.gz, "
        "or .zip."
    )


def _normalise(name):
    """The member's path relative to the archive root, or None if it escapes."""
    if not name or name in (".", "/"):
        return None
    cleaned = name.replace("\\", "/")
    if cleaned.startswith("/") or (len(cleaned) > 1 and cleaned[1] == ":"):
        return None
    parts = []
    for part in cleaned.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            return None
        parts.append(part)
    return posixpath.join(*parts) if parts else None


def inspect(path, *, max_bytes=DEFAULT_MAX_BYTES, max_members=DEFAULT_MAX_MEMBERS):
    """Read the archive's index and return (root, entries) without extracting anything."""
    handle, members, kind = open_archive(path)
    entries = []
    declared = 0
    roots = set()

    try:
        for name, size, is_dir, is_special in members(handle):
            if is_special:
                raise ArchiveRejected(
                    f"The archive contains a link or device node ({name!r}). A link can "
                    "redirect a write outside the run, and neither belongs in a model run, "
                    "so archives containing them are refused."
                )
            relative = _normalise(name)
            if relative is None:
                raise ArchiveRejected(
                    f"The archive contains an unsafe path ({name!r}). Paths that are "
                    "absolute or that climb out of the archive are refused."
                )
            declared += size
            if declared > max_bytes:
                raise ArchiveRejected(
                    f"The archive unpacks to more than {max_bytes // (1024 ** 3)} GiB."
                )
            entries.append((relative, size, is_dir))
            if len(entries) > max_members:
                raise ArchiveRejected(
                    f"The archive holds more than {max_members} entries."
                )
            head = relative.split("/")[0]
            if "/" in relative or is_dir:
                roots.add(head)
    finally:
        handle.close()

    if not entries:
        raise ArchiveRejected("The archive is empty.")

    root = roots.pop() if len(roots) == 1 else ""
    _require_run_shape(entries, root)
    return root, entries


def _require_run_shape(entries, root):
    """Refuse an archive that is not a model run, naming what is missing."""
    prefix = f"{root}/" if root else ""
    names = {name[len(prefix):] for name, _, _ in entries if name.startswith(prefix)}

    has_realization = any(
        name == REALIZATION or name.endswith(f"/{REALIZATION}") for name in names
    )
    if not has_realization:
        raise ArchiveRejected(
            f"No {REALIZATION} in the archive, so this does not look like a model run. "
            "Archive the run directory itself, the one holding config/ and outputs/."
        )
    for required in REQUIRED_DIRS:
        if not any(name == required or name.startswith(f"{required}/") for name in names):
            raise ArchiveRejected(
                f"No {required}/ directory in the archive, so there is nothing to plot."
            )


def extract(path, destination, *, max_bytes=DEFAULT_MAX_BYTES,
            max_members=DEFAULT_MAX_MEMBERS):
    """Unpack the run into ``destination`` and return the directory holding it."""
    root, _ = inspect(path, max_bytes=max_bytes, max_members=max_members)
    os.makedirs(destination, exist_ok=True)
    real_destination = os.path.realpath(destination)

    handle, _members, kind = open_archive(path)
    try:
        if kind == "tar":
            handle.extractall(destination, filter="data")
        else:
            _extract_zip(handle, destination, real_destination, max_bytes)
    finally:
        handle.close()

    unpacked = os.path.join(real_destination, root) if root else real_destination
    if not os.path.isdir(unpacked):
        raise ArchiveRejected("The archive did not unpack into a directory.")
    return unpacked


def _extract_zip(handle, destination, real_destination, max_bytes):
    """zipfile has no data filter, so the same rules are applied member by member."""
    written = 0
    for info in handle.infolist():
        relative = _normalise(info.filename)
        if relative is None:
            raise ArchiveRejected(f"Unsafe path in archive: {info.filename!r}")

        target = os.path.join(destination, relative)
        if os.path.commonpath(
            [os.path.realpath(os.path.dirname(target)), real_destination]
        ) != real_destination:
            raise ArchiveRejected(f"Entry escapes the destination: {info.filename!r}")

        if info.is_dir():
            os.makedirs(target, exist_ok=True)
            continue

        os.makedirs(os.path.dirname(target), exist_ok=True)
        with handle.open(info) as source, open(target, "wb") as sink:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise ArchiveRejected(
                        f"The archive unpacks to more than {max_bytes // (1024 ** 3)} GiB."
                    )
                sink.write(chunk)
