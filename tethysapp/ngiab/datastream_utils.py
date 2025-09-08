import boto3
import json
import os
import tarfile
import uuid
import shutil
from pathlib import Path
import tempfile
from typing import Iterable
from botocore import UNSIGNED
from botocore.client import Config
from botocore.exceptions import ClientError, BotoCoreError



from .utils import _get_conf_file

def list_public_s3_folders(
    bucket: str = "ciroh-community-ngen-datastream",
    prefix: str = "",
) -> list[str]:
    """
    Return the folder names (CommonPrefixes) that sit directly under
    s3://<bucket>/<prefix>

    Parameters
    ----------
    bucket : str
        Bucket name without “s3://”.
    prefix : str
        Path you want to inspect.  **Must end with “/”** to be treated
        as a folder.  Example:  "v2.2/".  Use "" for the bucket root.

    Returns
    -------
    list[str]
        Sorted list of folder names (no trailing “/”).
    """
    # Anonymous S3 client – no credentials required for a public bucket
    s3 = boto3.client("s3", config=Config(signature_version=UNSIGNED))

    # Use the paginator so we handle >1 000 keys automatically
    paginator = s3.get_paginator("list_objects_v2")
    pages = paginator.paginate(
        Bucket=bucket,
        Prefix=prefix,
        Delimiter="/",     # ask S3 to group objects by “folder”
    )

    folders: list[str] = []
    for page in pages:
        for cp in page.get("CommonPrefixes", []):
            # Keep only the last path segment, drop trailing “/”
            folders.append(cp["Prefix"].rstrip("/").split("/")[-1])

    return sorted(folders)

def _parse_date(date_str: str) -> str:

    get_date = date_str.split(".")[1]

    # Convert get_date from format YYYYMMDD to YYYY/MM/DD
    formatted_date = f"{get_date[:4]}-{get_date[4:6]}-{get_date[6:]}"

    return formatted_date


def get_dates_select_from_s3(list_of_interest: list[str]) -> list[str]:
    reverse_list_of_interest = sorted(list_of_interest, reverse=True)
    return [
        {"value": item_, "label": _parse_date(item_)}
        for item_ in reverse_list_of_interest
    ]

def get_select_from_s3(list_of_interest: list[str]) -> list[str]:
    return [
        {"value": item_, "label": item_}
        for item_ in list_of_interest
    ]

def remove_forcings_from_forecast_list(forecast_list: list[str]) -> list[str]:
    """
    Clean the forecast list to remove duplicates and sort it.
    """
    clean_list = []
    for forecast_type in forecast_list:
        if not forecast_type.startswith("forcing"):
            clean_list.append(forecast_type)
    
    clean_list.sort()
    return clean_list

def _create_datastream_conf_dir():
    """
    Create the datastream configuration directory if it does not exist.
    """
    home_path = os.environ.get("HOME", "/tmp")
    conf_dir_base_path = os.environ.get("DATASTREAM_CONF", f"{home_path}/.datastream_ngiab")
    if not os.path.exists(conf_dir_base_path):
        os.makedirs(conf_dir_base_path, exist_ok=True)
    return conf_dir_base_path

def _create_datastream_conf_file():
    """
    Create the datastream configuration file if it does not exist.
    """
    conf_base_path = _get_datastream_conf_file()
    if not os.path.exists(conf_base_path):
        os.makedirs(os.path.dirname(conf_base_path), exist_ok=True)
        with open(conf_base_path, "w") as f:
            f.write('{ "datastream": []}')
    return conf_base_path

def make_datastream_conf():
    """
    Create the datastream configuration directory and file if they do not exist.
    """
    _create_datastream_conf_dir()
    _create_datastream_conf_file()
    return
 
def _get_datastream_conf_file():
    home_path = os.environ.get("HOME", "/tmp")
    conf_dir_base_path = os.environ.get("DATASTREAM_CONF", f"{home_path}/.datastream_ngiab")
    conf_base_path = os.path.join(conf_dir_base_path, "datastream_ngiab.json")
    return conf_base_path

def _get_datastream_conf_dir():
    """
    Get the datastream configuration directory.
    """
    home_path = os.environ.get("HOME", "/tmp")
    conf_dir_base_path = os.environ.get("DATASTREAM_CONF", f"{home_path}/.datastream_ngiab")
    return conf_dir_base_path

def _add_datastream_data_to_conf(label: str, bucket:str, local_path: str, prefix: str) -> None:
    """
    Add the datastream data to the configuration file.
    """
    conf_base_path = _get_datastream_conf_file()
    with open(conf_base_path, "r") as f:
        conf = json.load(f)
    unique_id =  uuid.uuid4().hex
    individual_datastream = {
        "label": label,
        "bucket": bucket,
        "prefix": prefix,
        "path": local_path,
        "date": "2021-01-01:00:00:00",
        "id": unique_id,
    }
    conf["datastream"].append(individual_datastream)

    with open(conf_base_path, "w") as f:
        json.dump(conf, f, indent=4)

    return individual_datastream

def _add_datastream_data_to_model_conf(individual_datastream) -> None:
    """
    Add the datastream data to the configuration file.
    """
    conf_base_path = _get_conf_file()
    with open(conf_base_path, "r") as f:
        conf = json.load(f)

    conf["model_runs"].append(individual_datastream)

    with open(conf_base_path, "w") as f:
        json.dump(conf, f, indent=4)
    
    return

def check_if_s3_file_exists(bucket: str = "ciroh-community-ngen-datastream", tar_key: str= "") -> bool:
    """
    Check if a file exists at the given path.

    Parameters
    ----------
    file_path : str
        The path to the file to check.

    Returns
    -------
    bool
        True if the file exists, False otherwise.
    """
    s3 = boto3.client("s3", config=Config(signature_version=UNSIGNED))

    # First try a lightweight HEAD request so we fail fast if the key is absent.
    try:
        s3.head_object(Bucket=bucket, Key=tar_key)
        return True
    except ClientError as e:
        err_code = e.response["Error"]["Code"]
        if err_code in ("404", "NoSuchKey", "NotFound"):
            msg = f"S3 object '{tar_key}' not found in bucket '{bucket}'."
            return False
        # Something else (permissions, throttling, etc.) – re-throw.
        return False

def _download_tar_from_s3(bucket: str, tar_key: str, download_path: str) -> None:
    """
    Download a tar file from an S3 bucket, raising FileNotFoundError
    if the object does not exist.

    Parameters
    ----------
    bucket : str
        Name of the S3 bucket.
    tar_key : str
        S3 object key (path) of the tar file.
    download_path : str
        Local destination for the downloaded tar.

    Raises
    ------
    FileNotFoundError
        If the object key is not present in the bucket.
    BotoCoreError
        Any other boto3 / botocore-level error is re-raised unchanged.
    """
    s3 = boto3.client("s3", config=Config(signature_version=UNSIGNED))

    # First try a lightweight HEAD request so we fail fast if the key is absent.
    try:
        s3.head_object(Bucket=bucket, Key=tar_key)
    except ClientError as e:
        err_code = e.response["Error"]["Code"]
        if err_code in ("404", "NoSuchKey", "NotFound"):
            msg = f"S3 object '{tar_key}' not found in bucket '{bucket}'."
            raise FileNotFoundError(msg) from e
        # Something else (permissions, throttling, etc.) – re-throw.
        raise

    # Object exists – proceed with the full download.
    try:
        s3.download_file(Bucket=bucket, Key=tar_key, Filename=download_path)
    except (ClientError, BotoCoreError):
        raise


def _extract_keep_ngen_run(
    tar_path: str,
    work_dir: str,
    dst_name: str = "ngen-run",
) -> Path:
    """
    Extract only the subtree ending in 'ngen-run/' from *tar_path* into *work_dir*,
    rename it to *dst_name*, delete the tarball, and leave *work_dir* otherwise
    untouched. Handles archives that contain either:
      - 'home/ec2-user/outputs/ngen-run/...'
      - 'ngen-run/...'
    and similar variants (leading './', etc.).

    Returns the pathlib.Path to work_dir/dst_name.
    """

    def _norm(name: str) -> str:
        # Normalize tar member name to a safe, comparable relative POSIX path.
        # - strip leading './' and '/'
        # - convert backslashes (just in case) to '/'
        name = name.replace("\\", "/")
        while name.startswith("./"):
            name = name[2:]
        while name.startswith("/"):
            name = name[1:]
        return name

    def _is_within_directory(directory: str, target: str) -> bool:
        # Path traversal guard for extraction
        abs_directory = os.path.abspath(directory)
        abs_target = os.path.abspath(target)
        return os.path.commonprefix([abs_directory, abs_target]) == abs_directory

    def _safe_extract(tar: tarfile.TarFile, members: Iterable[tarfile.TarInfo], path: str) -> None:
        for m in members:
            dest = os.path.join(path, _norm(m.name))
            if not _is_within_directory(path, dest):
                raise RuntimeError(f"Blocked suspicious path in tar: {m.name!r}")
        tar.extractall(path=path, members=members)

    work_dir = Path(work_dir).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    kept_dst = work_dir / dst_name

    with tarfile.open(tar_path, "r:*") as tar:
        # Collect normalized names once
        members = list(tar.getmembers())
        names = [_norm(m.name) for m in members]

        # Find all base prefixes that include a path component exactly 'ngen-run'
        # Example: 'home/ec2-user/outputs/ngen-run/foo/bar' -> base 'home/ec2-user/outputs/ngen-run'
        candidate_bases = set()
        for nm in names:
            if not nm:  # skip empty
                continue
            parts = nm.split("/")
            if "ngen-run" in parts:
                idx = parts.index("ngen-run")
                base = "/".join(parts[: idx + 1])  # include 'ngen-run'
                if base:  # shouldn't be empty
                    candidate_bases.add(base)

        if not candidate_bases:
            # Helpful context for debugging: show a few top-level entries
            tops = sorted({p.split("/")[0] for p in names if p})[:8]
            raise FileNotFoundError(
                f"Could not locate a subtree containing 'ngen-run/' in {tar_path}.\n"
                f"Top-level entries seen: {tops}"
            )

        # If multiple distinct bases exist, prefer the shortest (most common case is only 1)
        # This resolves benign duplicates like both a dir entry and file entries under the same base.
        base_prefix = sorted(candidate_bases, key=len)[0]
        base_prefix_with_slash = base_prefix.rstrip("/") + "/"

        # Filter only the members under that base
        kept_members = [
            m for m in members
            if _norm(m.name) == base_prefix or _norm(m.name).startswith(base_prefix_with_slash)
        ]

        if not kept_members:
            raise FileNotFoundError(
                f"Found base '{base_prefix}', but no members under it in {tar_path}"
            )

        # Extract into an isolated temp dir under work_dir
        with tempfile.TemporaryDirectory(dir=str(work_dir)) as tmpdir:
            _safe_extract(tar, kept_members, tmpdir)
            src_dir = Path(tmpdir) / base_prefix  # this should now exist after extraction
            if not src_dir.exists():
                # Some tars might not include the explicit directory entry; create it if needed
                # by finding the nearest existing parent that ends with 'ngen-run'
                # (This usually won't trigger, but keeps things robust.)
                # Search down from longest to shortest path
                probe = None
                parts = base_prefix.split("/")
                for i in range(len(parts), 0, -1):
                    cand = Path(tmpdir) / "/".join(parts[:i])
                    if cand.exists():
                        probe = cand
                        break
                src_dir = probe if probe is not None else Path(tmpdir)

            # Replace/overwrite destination if it already exists
            if kept_dst.exists():
                if kept_dst.is_dir():
                    shutil.rmtree(kept_dst)
                else:
                    kept_dst.unlink()

            kept_dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src_dir), kept_dst)

    # Remove the tarball itself (match your original behavior)
    try:
        os.remove(tar_path)
    except OSError:
        pass  # non-fatal if we can't remove it

    return kept_dst


def download_and_extract_tar_from_s3(
    bucket: str = "ciroh-community-ngen-datastream",
    tar_key: str = "",
    name_folder: str = "",
) -> str:
    """
    Download a tar file from S3, extract it, add the datastream to the
    configuration, and return its ID.

    Raises
    ------
    RuntimeError
        If the S3 object is missing or any other S3 download error occurs.
    """
    datastream_conf_dir_path = _get_datastream_conf_dir()
    local_tar_path = os.path.join(datastream_conf_dir_path, os.path.basename(tar_key))

    # ── 1. Download ────────────────────────────────────────────────────────
    
    try:
        _download_tar_from_s3(bucket, tar_key, local_tar_path)
    except FileNotFoundError as e:
        raise RuntimeError(
            f"Datastream tar '{tar_key}' not found in bucket '{bucket}'."
        ) from e
    except (ClientError, BotoCoreError) as e:
        # Covers permission problems, network hiccups, throttling, etc.
        raise RuntimeError(
            f"Failed to download '{tar_key}' from bucket '{bucket}': {e}"
        ) from e
    except Exception as e:
        # Covers any other unexpected errors
        raise RuntimeError(
            f"Failed to download '{tar_key}' from bucket '{bucket}': {e}"
        ) from e
    # ── 2. Extract ─────────────────────────────────────────────────────────
    _extract_keep_ngen_run(
        tar_path=local_tar_path,
        work_dir=datastream_conf_dir_path,
        dst_name=name_folder,
    )

    # ── 3. Update configs ─────────────────────────────────────────────────
    individual_datastream = _add_datastream_data_to_conf(
        label=name_folder,
        bucket=bucket,
        local_path=f"{datastream_conf_dir_path}/{name_folder}",
        prefix=tar_key,
    )
    _add_datastream_data_to_model_conf(individual_datastream)

    # ── 4. Return the new datastream ID ───────────────────────────────────
    return individual_datastream["id"]

def _get_list_datastream_model_runs():
    """
        {
            "model_runs": [
                {
                    "label": "run1",
                    "path": "/home/aquagio/tethysdev/ciroh/ngen/ngen-data/AWI_16_2863657_007",
                    "date": "2021-01-01:00:00:00",
                    "id": "AWI_16_2863657_007",
                    "subset": "cat-2863657_subset", #to_implement
                    "tags": ["tag1", "tag2"], #to_implement
                },
                ....
            ]
        }
    """
    conf_file = _get_datastream_conf_file()
    with open(conf_file, "r") as f:
        data = json.load(f)
    return data

def get_datastream_model_runs_selectable():
    datastream_model_runs = _get_list_datastream_model_runs()
    return [
        {
            "value": datastream_model_run["id"], 
            "label": datastream_model_run["label"]
        }
        for datastream_model_run in datastream_model_runs["datastream"]
    ]

def check_if_datastream_data_exists(datastream_folder_name: str) -> bool:
    """
    Check if the datastream data exists in the configuration file.

    Parameters
    ----------
    datastream_folder_name : str
        The name of the datastream folder to check.

    Returns
    -------
    bool
        True if the datastream data exists, False otherwise.
    """
    conf_dir_path = _get_datastream_conf_dir()
    datastream_folder_path = os.path.join(conf_dir_path, datastream_folder_name)
    
    if not os.path.exists(datastream_folder_path):
        return False
    else:
        return True
    
def get_datastream_id_from_conf_file(datastream_folder_name: str) -> str:
    """
    Get the datastream ID from the configuration file.

    Parameters
    ----------
    datastream_folder_name : str
        The name of the datastream folder to check.

    Returns
    -------
    str
        The datastream ID if it exists, None otherwise.
    """
    conf_file = _get_datastream_conf_file()
    with open(conf_file, "r") as f:
        data = json.load(f)
    
    for datastream in data["datastream"]:
        if datastream["label"] == datastream_folder_name:
            return datastream["id"]
    
    return None