import boto3
import json
import os
import tarfile
import uuid
import shutil
from pathlib import Path
from botocore import UNSIGNED
from botocore.client import Config

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
    conf_base_path = os.environ.get("DATASTREAM_CONF", f"{home_path}/.datastream_ngiab/datastream_ngiab.json")
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

def _download_tar_from_s3(bucket: str, tar_key: str, download_path: str) -> None:
    """
    Download a tar file from an S3 bucket.

    Parameters
    ----------
    bucket : str
        The name of the S3 bucket.
    tar_key : str
        The S3 object key (path) for the tar file.
    download_path : str
        The local file path where the tar file will be saved.
    """
    s3 = boto3.client("s3", config=Config(signature_version=UNSIGNED))
    s3.download_file(Bucket=bucket, Key=tar_key, Filename=download_path)

def _extract_keep_ngen_run(
    tar_path: str,
    work_dir: str,
    dst_name: str = "ngen-run",
) -> Path:
    """
    Extract only the subtree  home/ec2-user/outputs/ngen-run/
    from *tar_path* into *work_dir*, rename it to *dst_name*, delete the
    tarball, and prune any *new* empty directories that were created.

    Anything that already existed inside *work_dir* is left untouched.
    """
    work_dir = Path(work_dir).resolve()
    KEEP_PREFIX = "home/ec2-user/outputs/ngen-run/"

    # ── record what was already in work_dir ──────────────────────────────
    preexisting = {p for p in work_dir.rglob("*") if p.is_dir()}

    # ── 1. selective extraction ──────────────────────────────────────────
    with tarfile.open(tar_path, "r:*") as tar:
        wanted = [m for m in tar.getmembers()
                  if m.name.startswith(KEEP_PREFIX)]
        if not wanted:
            raise FileNotFoundError(
                f"{KEEP_PREFIX!r} not found inside {tar_path}"
            )
        tar.extractall(path=work_dir, members=wanted)

    # ── 2. remove the tarball itself ─────────────────────────────────────
    os.remove(tar_path)

    # ── 3. move/rename the kept subtree ─────────────────────────────────
    kept_src = work_dir / KEEP_PREFIX.rstrip("/")
    kept_dst = work_dir / dst_name
    kept_dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(kept_src), kept_dst)

    # ── 4. prune *new* empty directories (bottom-up) ────────────────────
    for path in sorted(work_dir.rglob("*"), reverse=True):
        if (
            path.is_dir()
            and path not in preexisting
            and path != kept_dst
        ):
            try:
                path.rmdir()          # succeeds only if directory is empty
            except OSError:
                pass                  # not empty → keep it

    return kept_dst

def download_and_extract_tar_from_s3(bucket: str = "ciroh-community-ngen-datastream", tar_key: str="", name_folder: str="") -> None:
    """
    Download a tar file from an S3 bucket and extract its contents.

    Parameters
    ----------
    bucket : str
        The name of the S3 bucket.
    tar_key : str
        The S3 object key (path) for the tar file.
    extract_path : str
        The directory where the contents of the tar file will be extracted.
    """
    datastream_conf_dir_path = _get_datastream_conf_dir()
    
    # Define the local path for the downloaded tar file
    local_tar_path = os.path.join(datastream_conf_dir_path, os.path.basename(tar_key))

    # Download the tar file from S3
    _download_tar_from_s3(bucket, tar_key, local_tar_path)

    # Extract the contents of the tar file
    
    _extract_keep_ngen_run(
        tar_path=local_tar_path,
        work_dir=datastream_conf_dir_path,
        dst_name=name_folder,
    )
    # Add the datastream data to the configuration file
    individual_datastream = _add_datastream_data_to_conf(
        label=name_folder,
        bucket=bucket,
        local_path=f"{datastream_conf_dir_path}/{name_folder}",
        prefix=tar_key
    )
    # add it also to the model runs
    _add_datastream_data_to_model_conf(individual_datastream)
    # Return the path to the extracted files
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