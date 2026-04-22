---
title: TEEHR-Cloud API renamed `type` to `timeseries_type` — teehr 0.6.0 clients break
date: 2026-04-21
category: integration-issues
module: ngiab-teehr
problem_type: integration_issue
component: tooling
symptoms:
  - "pandera.errors.SchemaError: column 'type' not in dataframe. Columns in dataframe: ['name', 'description']"
  - "pydantic_core._pydantic_core.ValidationError: 1 validation error for Configuration\\n  timeseries_type\\n    Field required"
  - "ev.download.configurations(load=True) crashes immediately in scripts/teehr_ngen.py"
root_cause: wrong_api
resolution_type: dependency_update
severity: high
related_components:
  - ngen-visualizer
  - NGIAB-CloudInfra
tags:
  - teehr
  - api-drift
  - pandera
  - configuration
  - version-pinning
---

# TEEHR-Cloud API renamed `type` to `timeseries_type` — teehr 0.6.0 clients break

## Problem

The deployed TEEHR-Cloud API at `api.teehr.rtiamanzi.org` renamed the
`type` field on the `/collections/configurations/items` response to
`timeseries_type`. Client code pinned to `teehr==0.6.0` still expects `type`
and crashes on the first `ev.download.configurations(load=True)` call because
its pandera schema requires the now-missing column.

## Symptoms

Observed in `ngiab-teehr` (PR #8, `7-update-to-latest-teehr-version`) when
running `/home/aquagio/tethysdev/ciroh/ngen/ngiab-teehr/runTeehr.sh`:

- Stack trace ends with `pandera.errors.SchemaError: column 'type' not in
  dataframe. Columns in dataframe: ['name', 'description']`.
- Error originates at `scripts/teehr_ngen.py:166` (the `ev.download.configurations(...)` call)
  and bubbles through `teehr/evaluation/download.py:608` -> `teehr/evaluation/load.py:139`.
- Pandera's `strict="filter"` silently drops the real `timeseries_type`
  column before validation, which is why the error message reports only
  `['name', 'description']` — the other fields the API returns
  (`timeseries_type`, `created_at`, `updated_at`, `properties`) are already
  filtered out by the time pandera checks required columns.
- After bumping teehr, a **second** error surfaces at `teehr_ngen.py:160`:
  `ValidationError: 1 validation error for Configuration\n  timeseries_type\n    Field required`.
  The `Configuration` Pydantic model was renamed in lockstep with the pandera
  schema; `Configuration(type=...)` is no longer valid.

## What Didn't Work

- **Patching `scripts/teehr_ngen.py` to skip the failing `download.configurations`
  calls and hard-code `ev.configurations.add(...)` instead.** Tempting (it
  bypasses the bad path), but defeats the purpose of PR testing — the PR's
  authored code is what must work. Also: the rest of the script still calls
  `download.primary_timeseries`, `download.secondary_timeseries`, and
  `download.location_crosswalks`, any of which could drift the same way.
- **Searching for a client-side `field_mapping={'timeseries_type': 'type'}` arg.**
  `ev.download.configurations` doesn't accept field_mapping; it calls
  `self._load.dataframe` internally with no rename hook.

## Solution

Two small changes in `ngiab-teehr`:

1. **Bump teehr in `requirements.txt`** (the source of truth; `pyproject.toml`
   already allowed the range `>=0.6.0,<0.7`):

   ```diff
   - teehr==0.6.0 ; python_version >= "3.12" and python_version < "3.14"
   + teehr==0.6.2 ; python_version >= "3.12" and python_version < "3.14"
   ```

2. **Rename the `Configuration` field at `scripts/teehr_ngen.py:160`:**

   ```diff
     ev.configurations.add(
         Configuration(
             name=ngen_configuration_name,
   -         type="secondary",
   +         timeseries_type="secondary",
             description="Nextgen simulation output"
         )
     )
   ```

3. Rebuild the image (`docker build -t awiciroh/ngiab-teehr:local .`) and
   rerun `runTeehr.sh`. Clean warehouse in a fresh fixture dir or wipe
   `<warehouse>/local/` before retry so leftover partial tables don't
   conflict with `append` writes.

Verified: the full teehr run completes and writes all 10 expected Iceberg
tables plus `teehr_run_manifest.json`.

## Why This Works

teehr 0.6.1 renamed **both** surfaces in lockstep with the API: the pandera
schema in `teehr/models/pandera_dataframe_schemas.py` and the
`Configuration` Pydantic model. 0.6.2 is the latest patch in the series
and carries the same rename. The pin `teehr==0.6.0` froze the client at the
last version that still expected `type` — against a live API that no longer
returns it.

The API change itself looks intentional — `timeseries_type` is a more
descriptive name that doesn't shadow Python's built-in `type`. The lesson
isn't "the API is wrong," it's "a deployed API can drift under a pinned
client."

## Prevention

### 1. Don't pin to `.0` patch versions in `requirements.txt` unless necessary

teehr patches since 0.6.0 were explicitly compatibility fixes for exactly this
kind of server-side drift. Using `pyproject.toml`'s range `teehr>=0.6.0,<0.7`
with regenerated `requirements.txt` (`poetry export --without-hashes -o
requirements.txt`) picks up these fixes automatically on image rebuild.

### 2. Add a smoke test that exercises the download path

`scripts/tests/test_api_smoke.py` should run each `ev.download.*(load=True)`
call site against the real API and assert no `SchemaError`. Gate with a
`network` pytest marker so CI can skip it when offline:

```python
import pytest
from teehr import LocalReadWriteEvaluation

@pytest.mark.network
def test_configurations_download(tmp_path):
    ev = LocalReadWriteEvaluation(dir_path=tmp_path, create_dir=True)
    df = ev.download.configurations(name="usgs_observations", load=False)
    # The fact that load=False returns a DataFrame (not crashes on load=True)
    # proves the pandera schema matches the API's current column set.
    assert "timeseries_type" in df.columns
```

### 3. Diagnose pandera failures by looking at the RAW API response

`pandera`'s `strict="filter"` silently drops unknown columns BEFORE the
required-columns check. The error message can mislead you: it reports only
the columns that survived filtering, not what the API actually returned.
When a `SchemaError` says "columns in dataframe: ['name', 'description']"
and the API returns 6 columns, those missing 4 are filtered, not absent.
Direct `curl` against the API is the fastest way to see the real shape:

```bash
curl -sS "https://api.teehr.rtiamanzi.org/collections/configurations/items?name=usgs_observations"
```

### 4. Pin the container image tag in orchestration scripts

`NGIAB-CloudInfra/runTeehr.sh` should pin `awiciroh/ngiab-teehr:<exact-tag>`
rather than `:latest` — so a fresh teehr-side release doesn't silently pull
into the next NGIAB run. Bumping the tag becomes an explicit PR step rather
than a surprise.

## Related Issues

- ngiab-teehr PR #8 (`7-update-to-latest-teehr-version`) —
  https://github.com/CIROH-UA/ngiab-teehr/pull/8
- Upstream teehr changelog: https://github.com/RTIInternational/teehr/releases
- Related learning: `docs/solutions/integration-issues/duckdb-1-1-3-cannot-read-teehr-iceberg-2026-04-21.md`
  (DuckDB version must be bumped alongside teehr to read what 0.6.2 writes).
