import boto3
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

def get_select_from_s3(list_of_interest: list[str]) -> list[str]:

    return [
        {"value": item_, "label": item_}
        for item_ in list_of_interest
    ]