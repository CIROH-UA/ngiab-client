"""Guards on dependency choices that took research to make and look wrong at a glance.

Read docs/plans/2026-08-22-001-feat-storage-backed-model-runs-plan.md, Unit 2 and Unit 3.
"""

import importlib.metadata as metadata
import json

import pytest


def test_django_storages_is_installed_from_git_not_pypi():
    """The released 1.14.6 does not declare support for the Django this image ships.

    django-storages 1.14.6 is from April 2025 and its classifiers stop at Django 5.1; the
    image ships Django 5.2.16. Support for 5.2 was merged afterwards and is still unreleased,
    so pyproject.toml pins a master commit.

    This is worth a test because ``storages.__version__`` still reads "1.14.6" on master --
    nothing in the package itself reveals which one is installed. Replacing the git URL with
    a PyPI specifier would look like a tidy-up, pass every other test, and silently put the
    app on an untested Django combination. PEP 610's direct_url.json is the only honest
    signal.
    """
    raw = metadata.distribution("django-storages").read_text("direct_url.json")
    assert raw is not None, (
        "django-storages appears to be installed from PyPI. pyproject.toml pins a git commit "
        "because no release declares Django 5.2 support."
    )
    assert json.loads(raw)["vcs_info"]["vcs"] == "git"


def test_duckdb_is_pinned_exactly():
    """Extensions are matched to the DuckDB version and installed at image build time.

    A floating range resolves to whatever is current at build time, which silently orphans
    the extension directory the build populated -- the failure is a LOAD error at runtime,
    far from the pin that caused it.
    """
    import duckdb

    requires = metadata.metadata("tethysapp-ngiab").get_all("Requires-Dist") or []
    duckdb_requirement = next((r for r in requires if r.startswith("duckdb")), "")
    assert "==" in duckdb_requirement, f"duckdb should be pinned exactly, got {duckdb_requirement!r}"
    assert duckdb.__version__ in duckdb_requirement


@pytest.mark.parametrize("extension", ["httpfs", "aws", "sqlite", "iceberg", "avro"])
def test_required_duckdb_extensions_are_present_in_the_image(extension):
    """Installed at build time because the runtime has no route to extensions.duckdb.org."""
    from tethysapp.ngiab import duckdb_conn

    connection = duckdb_conn.connect_isolated()
    try:
        connection.execute(f"LOAD {extension}")
    finally:
        connection.close()
