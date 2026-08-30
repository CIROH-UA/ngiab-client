"""Guards on dependency choices that took research to make and look wrong at a glance."""

import importlib.metadata as metadata

import pytest
from packaging.version import Version


def test_django_storages_takes_the_django_this_image_ships():
    """1.14.6 lists no Django 5.2 classifier, which reads as a block and is not one.

    The classifiers are informational; the requirement is Django>=4.2 with no ceiling, so the
    release installs and the S3 backend loads. This app was pinned to a git commit over that
    misreading, which made every build of it fetch from GitHub. The portal already runs the
    release.
    """
    requires = metadata.metadata("django-storages").get_all("Requires-Dist") or []
    django_requirement = next(r for r in requires if r.lower().startswith("django"))
    assert ">=" in django_requirement and "<" not in django_requirement, django_requirement

    import django
    from storages.backends.s3 import S3Storage

    floor = Version(django_requirement.split(">=", 1)[1].strip())
    assert Version(django.__version__) >= floor
    assert S3Storage is not None


def test_duckdb_is_pinned_exactly():
    """Extensions are matched to the DuckDB version and installed at image build time."""
    import duckdb

    requires = metadata.metadata("tethysapp-ngiab").get_all("Requires-Dist") or []
    duckdb_requirement = next((r for r in requires if r.startswith("duckdb")), "")
    assert "==" in duckdb_requirement, f"duckdb should be pinned exactly, got {duckdb_requirement!r}"
    assert duckdb.__version__ in duckdb_requirement


@pytest.mark.parametrize("extension", ["httpfs", "aws"])
def test_required_duckdb_extensions_are_present_in_the_image(extension):
    """Installed at build time because the runtime has no route to extensions.duckdb.org."""
    from tethysapp.ngiab import duckdb_conn

    connection = duckdb_conn.connect_isolated()
    try:
        connection.execute(f"LOAD {extension}")
    finally:
        connection.close()
