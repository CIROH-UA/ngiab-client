"""Unpack an uploaded run archive, refusing everything that is not a run.

Refuses special files, escaping paths, unbounded expansion, and archives that are not runs.
"""

import logging
import os
import posixpath
import shutil
import tarfile
import zipfile

logger = logging.getLogger(__name__)

DEFAULT_MAX_BYTES = 32 * 1024 * 1024 * 1024

DEFAULT_MAX_MEMBERS = 500_000

HEADROOM_FRACTION = 0.10

HEADROOM_FLOOR = 256 * 1024 * 1024

REALIZATION = "realization.json"
REQUIRED_DIRS = ("outputs",)

# Run-relative trees the visualiser never opens, so it neither unpacks nor publishes them.
# Measured on gage-07144100: forcings is 239 MB of a 312 MB run, and cat_config is 407 of the
# objects a published run would otherwise carry. On gage-10154200 forcings is effectively the
# whole 2.0 GB. None of these names appears in the app's Python, JavaScript or templates.
#
# What this makes is a run to look at, not a run to re-run: realization.json still names the
# forcings and the per-catchment configs, and they will not be beside it. The archive the
# uploader sent remains the reproducible copy.
UNREAD_DIRS = ("forcings", "restart", "config/cat_config")


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


def skipped(relative, root, skip):
    """Whether this member sits in one of the run-relative trees named in ``skip``.

    Matching is on whole path segments from the run root down, so ``forcings`` does not also
    claim ``outputs/forcings``, and a tree can be named at any depth.
    """
    if not skip:
        return False
    prefix = f"{root}/" if root else ""
    inside = relative[len(prefix):] if relative.startswith(prefix) else relative
    return any(inside == tree or inside.startswith(f"{tree}/") for tree in skip)


def usable_bytes(destination):
    """How much this filesystem can absorb, or None when it cannot be measured.

    ``destination`` usually does not exist yet, so the nearest existing parent is what gets
    measured. A slice of the free space is held back: filling a disk to the last byte breaks
    whatever else shares it, and the run still has a manifest and its parquet to write after
    the archive is unpacked.
    """
    probe = os.path.abspath(destination)
    while not os.path.exists(probe):
        parent = os.path.dirname(probe)
        if parent == probe:
            break
        probe = parent
    try:
        free = shutil.disk_usage(probe).free
    except OSError:
        logger.warning("Could not measure free space at %s", probe, exc_info=True)
        return None
    return max(0, free - max(HEADROOM_FLOOR, int(free * HEADROOM_FRACTION)))


def _too_large(cap, limited_by_disk):
    """Why the archive was refused, in the terms that let the caller act on it."""
    if limited_by_disk:
        return (
            f"The archive unpacks to more than {_describe(cap)}, which is the free space "
            "left on the disk this run unpacks onto. Free some space, or upload a "
            "smaller run."
        )
    return f"The archive unpacks to more than {_describe(cap)}."


def _describe(count):
    """A byte count in the largest unit that leaves it readable."""
    if count >= 1024 ** 3:
        return f"{count / 1024 ** 3:.1f} GiB"
    if count >= 1024 ** 2:
        return f"{count / 1024 ** 2:.0f} MiB"
    return f"{count} bytes"


def inspect(path, *, max_bytes=DEFAULT_MAX_BYTES, max_members=DEFAULT_MAX_MEMBERS,
            limited_by_disk=False, skip=()):
    """Read the archive's index and return (root, entries) without extracting anything.

    ``skip`` names top-level trees the caller will not unpack. Their members are still
    checked for unsafe paths and links, because a refusal has to be about the archive rather
    than about which parts of it this caller happens to want, but their bytes do not count
    against ``max_bytes``: charging a run for what never reaches the disk would refuse runs
    that fit.
    """
    handle, members, kind = open_archive(path)
    entries = []
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

    declared = sum(
        size for relative, size, _is_dir in entries if not skipped(relative, root, skip)
    )
    if declared > max_bytes:
        raise ArchiveRejected(_too_large(max_bytes, limited_by_disk))

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
            max_members=DEFAULT_MAX_MEMBERS, skip=()):
    """Unpack the run into ``destination`` and return the directory holding it.

    The byte cap is whichever is smaller, the caller's ceiling or what the destination disk
    can actually absorb. Left at the ceiling alone the disk fills first, and a full disk
    arrives as an OSError partway through with a half-written run behind it, rather than as
    a refusal the uploader can read.
    """
    usable = usable_bytes(destination)
    limited_by_disk = usable is not None and usable < max_bytes
    if limited_by_disk:
        max_bytes = usable

    root, _ = inspect(path, max_bytes=max_bytes, max_members=max_members,
                      limited_by_disk=limited_by_disk, skip=skip)
    os.makedirs(destination, exist_ok=True)
    real_destination = os.path.realpath(destination)

    handle, _members, kind = open_archive(path)
    try:
        if kind == "tar":
            handle.extractall(
                destination, members=_wanted(handle, root, skip), filter="data"
            )
        else:
            _extract_zip(handle, destination, real_destination, max_bytes,
                         limited_by_disk, root, skip)
    finally:
        handle.close()

    unpacked = os.path.join(real_destination, root) if root else real_destination
    if not os.path.isdir(unpacked):
        raise ArchiveRejected("The archive did not unpack into a directory.")
    return unpacked


def _wanted(handle, root, skip):
    """The tar members to unpack, leaving out the trees the caller does not want."""
    for info in handle.getmembers():
        relative = _normalise(info.name)
        if relative is None or skipped(relative, root, skip):
            continue
        yield info


def _extract_zip(handle, destination, real_destination, max_bytes, limited_by_disk=False,
                 root="", skip=()):
    """zipfile has no data filter, so the same rules are applied member by member."""
    written = 0
    for info in handle.infolist():
        relative = _normalise(info.filename)
        if relative is None:
            raise ArchiveRejected(f"Unsafe path in archive: {info.filename!r}")
        if skipped(relative, root, skip):
            continue

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
                    raise ArchiveRejected(_too_large(max_bytes, limited_by_disk))
                sink.write(chunk)
