import boto3
import json
import os
import tarfile
import uuid
from botocore import UNSIGNED
from botocore.client import Config


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

    individual_datastream = {
        "label": label,
        "bucket": bucket,
        "prefix": prefix,
        "path": local_path,
        "date": "2021-01-01:00:00:00",
        "id": uuid.uuid4().hex,
    }
    conf["datastream"] = individual_datastream

    with open(conf_base_path, "w") as f:
        json.dump(conf, f, indent=4)


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

def _extract_tar_file(tar_path: str, extract_path: str) -> None:
    """
    Extract a tar file to a specified directory.

    Parameters
    ----------
    tar_path : str
        The path to the tar file.
    extract_path : str
        The directory where the contents of the tar file will be extracted.
    """

    with tarfile.open(tar_path, "r") as tar:
        tar.extractall(path=extract_path)
        tar.close()
    # Remove the tar file after extraction
    os.remove(tar_path)

def download_and_extract_tar_from_s3(bucket: str = "ciroh-community-ngen-datastream", tar_key: str="") -> None:
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
    dir_name = tar_key.split("/")[-1]
    extract_path = os.path.join(datastream_conf_dir_path, dir_name)
    # Create the directory if it doesn't exist
    os.makedirs(extract_path, exist_ok=True)

    # Define the local path for the downloaded tar file
    local_tar_path = os.path.join(extract_path, os.path.basename(tar_key))

    # Download the tar file from S3
    _download_tar_from_s3(bucket, tar_key, local_tar_path)

    # Extract the contents of the tar file
    _extract_tar_file(local_tar_path, extract_path)
    # Add the datastream data to the configuration file
    _add_datastream_data_to_conf(
        label=os.path.basename(tar_key),
        bucket=bucket,
        local_path=extract_path,
        prefix=tar_key
    )
    # Return the path to the extracted files
    return extract_path