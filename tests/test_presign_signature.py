"""The upload URL must be presigned with SigV4.

SigV2 (the botocore fallback on the global S3 endpoint) folds Content-Type into
the signature, so a browser PUT that sends its own Content-Type fails with
SignatureDoesNotMatch. SigV4 query presign does not sign Content-Type, so the
browser can send whatever it likes. This guards against a regression to SigV2.
"""

from types import SimpleNamespace

import boto3
import pytest

from tethysapp.ngiab import controllers, run_store


@pytest.fixture
def s3_backend(monkeypatch):
    """A stub run-storage backend whose client would otherwise presign SigV2."""
    client = boto3.client(
        "s3",
        region_name="us-east-1",
        aws_access_key_id="AKIAEXAMPLE",
        aws_secret_access_key="secret",  # noqa: S106 - offline presign, never sent
    )
    backend = SimpleNamespace(
        bucket_name="run-bucket",
        region_name="us-east-1",
        access_key="AKIAEXAMPLE",
        secret_key="secret",
        security_token=None,
        connection=SimpleNamespace(meta=SimpleNamespace(client=client)),
    )
    monkeypatch.setattr(run_store, "storage", lambda: backend)
    monkeypatch.setattr(run_store, "raw_key", lambda b, key: key)
    return backend


def test_presigned_put_is_sigv4(s3_backend):
    url = controllers._presigned_put("run/archive")
    # SigV4 query auth carries X-Amz-* params; SigV2 carries AWSAccessKeyId/Signature.
    assert "X-Amz-Signature" in url
    assert "X-Amz-Algorithm=AWS4-HMAC-SHA256" in url
    assert "AWSAccessKeyId" not in url


def test_presigned_put_does_not_sign_content_type(s3_backend):
    """Content-Type must not be in the signed headers, or a browser PUT would 403."""
    url = controllers._presigned_put("run/archive")
    signed = None
    for part in url.split("?", 1)[1].split("&"):
        if part.startswith("X-Amz-SignedHeaders="):
            signed = part.split("=", 1)[1].lower()
    # Asserted separately: SigV2 emits no SignedHeaders at all, so a bare "content-type not in
    # signed" passed against the very regression this test is named for.
    assert signed is not None, "no X-Amz-SignedHeaders, so this is not a SigV4 presign"
    assert signed == "host", signed
