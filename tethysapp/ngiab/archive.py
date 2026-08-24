"""Unpack an uploaded run archive, refusing everything that is not a run.

An archive is the first thing in this app that a user supplies wholesale. Every other input
is a name the listing just produced, or a value from a directory an operator placed. So the
threat model changes here rather than gradually: the bytes decide what paths get written, how
many, and how large, and all three are attacker-controlled.

Three refusals, each for a different failure:

0. **Members that are not files.** Devices, FIFOs and links have no place in a model run,
   and each is a way to make extraction do something other than write bytes. tarfile's
   ``data`` filter refuses them at extract time, but by raising ``SpecialFileError`` -- not
   ``ArchiveRejected`` -- so the contract this module promises was broken for exactly the
   inputs it exists to refuse. They are rejected during ``inspect`` instead.

1. **Paths that escape.** ``../../etc/cron.d/x`` and ``/etc/cron.d/x`` both name a
   destination outside the extraction directory, and a symlink member can redirect a later
   write after the fact. tarfile's ``data`` filter (PEP 706) covers the tar side and is used
   rather than reimplemented; zipfile has no equivalent, so the same rules are applied by
   hand. Every member is checked against the realpath of the destination, which is what
   catches the symlink case that a string comparison misses.

2. **Archives that expand without bound.** A few hundred kilobytes of zeros expands to
   gigabytes, and the process that notices is the one that fills the disk the portal runs
   on. Both the declared total and the running total are capped, because a declared size is
   a claim and the running total is the fact.

3. **Archives that are not runs.** A run has a realization and an output directory. Checking
   before extraction means an archive of something else costs a header read rather than a
   full unpack, and the user gets told what was missing instead of watching a conversion fail
   on an empty directory.

Nothing here writes into the storage root. Extraction goes to a caller-supplied directory,
and publishing is a separate step, so a rejected archive cannot leave a partial run where the
picker would list it.
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
    """The archive is malformed, unsafe, or not a model run.

    Its own class so a caller can answer 400 with the reason rather than 500 with a
    traceback: every case this covers is something the user can act on.
    """


def _members_tar(handle):
    for info in handle.getmembers():
        special = info.issym() or info.islnk() or info.isdev()
        yield info.name, info.size, info.isdir(), special


def _members_zip(handle):
    for info in handle.infolist():
        yield info.filename, info.file_size, info.is_dir(), False


def open_archive(path):
    """Open ``path`` as tar or zip, whichever it is, or refuse it.

    Sniffed rather than taken from the filename, because the filename is supplied by the
    same person as the bytes.
    """
    if tarfile.is_tarfile(path):
        return tarfile.open(path, "r:*"), _members_tar, "tar"
    if zipfile.is_zipfile(path):
        return zipfile.ZipFile(path), _members_zip, "zip"
    raise ArchiveRejected(
        "That file is neither a tar nor a zip archive. Upload the run as .tar, .tar.gz, "
        "or .zip."
    )


def _normalise(name):
    """The member's path relative to the archive root, or None if it escapes.

    Rejects absolute paths, drive letters, and any traversal. Returns a posix-style relative
    path with no leading separator, which is what the containment check below compares.
    """
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
    """Read the archive's index and return (root, entries) without extracting anything.

    ``root`` is the single top-level directory the run lives under, which is what an archive
    made with ``tar -czf run.tar.gz myrun`` produces. An archive holding the run's contents
    at the top level is accepted too, with a root of "".
    """
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
    """Unpack the run into ``destination`` and return the directory holding it.

    ``inspect`` runs first, so an archive that would be refused costs a header read rather
    than a partial unpack. The running byte total is enforced during extraction as well,
    because a member's declared size is a claim made by the archive.
    """
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
