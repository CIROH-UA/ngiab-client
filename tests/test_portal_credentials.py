"""Run storage borrows the portal's media bucket, and DuckDB borrows its credentials.

Two things reach the bucket by different routes: the Django storage interface reads the
manifest and its sidecars, DuckDB reads the bulk. Only the first is configured by Django.

Measured before writing any of this: with AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and
AWS_REGION all exported, ``SELECT * FROM duckdb_secrets()`` returns nothing -- DuckDB 1.5 does
not consult the AWS environment. Every parquet read then fails, and the message names the
wrong cause: with no region resolved it reports ``NoSuchBucket`` against the real AWS
endpoint, which reads as "your bucket is missing" rather than "I have no credentials".

So the secret is built from the same storage object django-storages resolved. One source for
both halves, because the failure when they disagree is a 403 that the run listing reports as
an empty picker.
"""

import pytest
from django.test import override_settings

from tethysapp.ngiab import duckdb_conn, run_store


@pytest.fixture
def hosted(monkeypatch):
    monkeypatch.setenv("NGIAB_STORAGE_BACKEND", "s3")
    duckdb_conn.reset()
    yield
    duckdb_conn.reset()


def media_storages(**options):
    """A portal whose media already lives in a bucket, and no ngiab_runs alias."""
    base = {
        "bucket_name": "portal-media",
        "access_key": "AKIAEXAMPLE",
        "secret_key": "s3cr3t",
        "region_name": "us-west-2",
    }
    base.update(options)
    return {
        "default": {"BACKEND": "storages.backends.s3.S3Storage", "OPTIONS": base},
        "staticfiles": {
            "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
        },
    }


# ---- Borrowing the portal's storage -----------------------------------------


def test_the_run_store_uses_the_portal_media_bucket(hosted):
    """No second alias to configure, so there is nothing for an administrator to mistype."""
    with override_settings(STORAGES=media_storages()):
        assert run_store.storage().bucket_name == "portal-media"


def test_runs_go_under_a_prefix_of_their_own(hosted):
    """Otherwise run directories interleave with uploaded media at the bucket root."""
    with override_settings(STORAGES=media_storages()):
        assert run_store.location("alpha") == "s3://portal-media/ngiab_visualizer/alpha"


def test_an_existing_media_prefix_is_kept(hosted):
    """A portal that already namespaces its media keeps that namespace."""
    with override_settings(STORAGES=media_storages(location="media")):
        assert run_store.location("alpha") == "s3://portal-media/media/ngiab_visualizer/alpha"


def test_the_prefix_is_overridable(hosted, monkeypatch):
    monkeypatch.setenv("NGIAB_RUNS_PREFIX", "model_runs")
    with override_settings(STORAGES=media_storages()):
        assert run_store.location("alpha") == "s3://portal-media/model_runs/alpha"


def test_an_explicit_alias_still_wins(hosted):
    """Borrowing is the fallback, not the rule: a deployment can still use its own bucket."""
    storages = media_storages()
    storages[run_store.STORAGE_ALIAS] = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {"bucket_name": "runs-only"},
    }
    with override_settings(STORAGES=storages):
        assert run_store.storage().bucket_name == "runs-only"


def test_a_portal_with_no_object_storage_says_so(hosted):
    """Rather than reporting an empty bucket, which is what the old failure looked like."""
    with override_settings(STORAGES={}):
        with pytest.raises(run_store.StorageUnreachable):
            run_store.location("alpha")


def test_local_deployments_are_untouched(monkeypatch):
    """No STORAGES entry of any kind is needed on a laptop."""
    monkeypatch.delenv("NGIAB_STORAGE_BACKEND", raising=False)
    monkeypatch.setenv("NGIAB_MANAGED_ROOT", "/tmp/runs")
    assert run_store.location("alpha") == "/tmp/runs/alpha"


# ---- The DuckDB secret ------------------------------------------------------


def test_no_secret_is_built_for_a_local_deployment(monkeypatch):
    monkeypatch.delenv("NGIAB_STORAGE_BACKEND", raising=False)
    assert run_store.duckdb_secret_sql() is None


def test_the_secret_carries_the_portal_key(hosted):
    with override_settings(STORAGES=media_storages()):
        sql = run_store.duckdb_secret_sql()
    assert "TYPE s3" in sql
    assert "KEY_ID 'AKIAEXAMPLE'" in sql
    assert "SECRET 's3cr3t'" in sql
    assert "REGION 'us-west-2'" in sql


def test_a_portal_without_static_keys_uses_the_credential_chain(hosted):
    """The normal shape when the portal authenticates by instance or workload identity."""
    with override_settings(STORAGES=media_storages(access_key=None, secret_key=None)):
        sql = run_store.duckdb_secret_sql()
    assert "PROVIDER credential_chain" in sql
    assert "KEY_ID" not in sql


def test_a_custom_endpoint_is_reduced_to_a_host(hosted):
    """DuckDB wants host[:port]; the scheme is carried by USE_SSL instead."""
    with override_settings(STORAGES=media_storages(endpoint_url="https://s3.example.org")):
        sql = run_store.duckdb_secret_sql()
    assert "ENDPOINT 's3.example.org'" in sql
    assert "USE_SSL true" in sql
    assert "URL_STYLE 'path'" in sql


def test_a_plaintext_endpoint_disables_ssl(hosted):
    with override_settings(STORAGES=media_storages(endpoint_url="http://minio:9000")):
        sql = run_store.duckdb_secret_sql()
    assert "ENDPOINT 'minio:9000'" in sql
    assert "USE_SSL false" in sql


def test_a_quote_in_a_credential_cannot_break_out(hosted):
    """The secret is interpolated, so it goes through the same quoting every path does."""
    with override_settings(STORAGES=media_storages(secret_key="a'b")):
        assert "SECRET 'a''b'" in run_store.duckdb_secret_sql()
