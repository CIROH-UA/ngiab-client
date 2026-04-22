---
title: DuckDB 1.1.3 iceberg extension fails on teehr-written Iceberg tables
date: 2026-04-21
category: integration-issues
module: ngiab-client
problem_type: integration_issue
component: database
symptoms:
  - "IOException: Invalid field found while parsing field: type (on configurations, location_crosswalks, locations tables)"
  - "IOException: No snapshots found (on empty attributes, location_attributes tables)"
  - "iceberg_scan(metadata_location) fails for 3 of 5 tables the visualizer needs"
root_cause: wrong_api
resolution_type: dependency_update
severity: high
related_components:
  - teehr
  - iceberg
tags:
  - duckdb
  - iceberg
  - sqlite_scanner
  - version-pinning
  - teehr
---

# DuckDB 1.1.3 iceberg extension fails on teehr-written Iceberg tables

## Problem

DuckDB 1.1.3's Iceberg extension cannot read three of the five Iceberg tables
teehr 0.6.2 writes (`configurations`, `location_crosswalks`, `locations`).
The tables fail with `IOException: Invalid field found while parsing field:
type` on any `iceberg_scan` call, blocking the entire visualizer read path.
DuckDB 1.5.2 reads all tables cleanly against the same warehouse.

## Symptoms

Running a minimal reader against `<warehouse>/local/local_catalog.db`:

```python
import duckdb
con = duckdb.connect(":memory:")
con.execute("INSTALL sqlite; LOAD sqlite; INSTALL iceberg; LOAD iceberg;")
con.execute("ATTACH '<warehouse>/local/local_catalog.db' AS cat (TYPE sqlite, READ_ONLY)")
# ... get metadata_location for each teehr table via iceberg_tables ...
con.execute(f"SELECT count(*) FROM iceberg_scan('{metadata_location}')")
```

Under DuckDB **1.1.3**:

| Table | Result |
|---|---|
| `configurations` | FAIL — `Invalid field found while parsing field: type` |
| `location_crosswalks` | FAIL — same error |
| `locations` | FAIL — same error |
| `attributes`, `location_attributes` (empty) | FAIL — `No snapshots found` |
| `ngen_metrics`, `primary_timeseries`, `secondary_timeseries`, `units`, `variables` | OK |

Under DuckDB **1.5.2** against the same warehouse directory: all 10 tables
parse cleanly with correct column lists, including `timeseries_type`,
`properties`, and geometry columns.

## What Didn't Work

- **Calling `iceberg_scan(path, allow_moved_paths=true)`** — the
  `allow_moved_paths=true` flag throws `InvalidInputException: Enabling
  allow_moved_paths is not enabled for directly scanning metadata files` in
  1.1.3. That flag is only accepted when the path is a table-root directory,
  not a direct `.metadata.json` file. Teehr's `iceberg_tables.metadata_location`
  always points at a direct file.
- **Trying DuckDB 1.1.3's `ATTACH ... (TYPE ICEBERG_JDBC_SQLITE)` catalog adapter**
  — that adapter does not exist in 1.1.3. Confirmed by `Extension
  "iceberg_jdbc_sqlite.duckdb_extension" not found`.
- **Assuming the upstream `duckdb/duckdb_iceberg` GitHub README's
  "experimental" disclaimer meant the extension was unusable.** The official
  DuckDB docs do not label the extension experimental; 1.5+ handles the
  format fine. The disclaimer is stale for current stable releases. The
  real gap in 1.1.3 is reader coverage for specific Iceberg metadata shapes,
  not extension stability.

## Solution

Bump DuckDB to 1.5.x and add `pytz` as an explicit dep (needed by DuckDB 1.5
for tz-aware timestamp columns in `ngen_metrics.created_at/updated_at`):

```diff
 # pyproject.toml
 [project]
- dependencies = ["duckdb", "geopandas", "xarray", "netcdf4>=1.7.2", "numpy<2", "botocore", "boto3"]
+ dependencies = ["duckdb>=1.5,<1.6", "geopandas", "xarray", "netcdf4>=1.7.2", "numpy<2", "botocore", "boto3", "pytz"]
```

Pre-install DuckDB extensions at image build time so runtime doesn't require
network egress to `extensions.duckdb.org`:

```diff
 # Dockerfile
+ # Pre-install DuckDB extensions (sqlite, iceberg) so runtime LOAD works offline.
+ RUN cd ${APP_SRC_ROOT} \
+     && ${PDM} run python -c "import duckdb; c=duckdb.connect(); c.execute('INSTALL sqlite'); c.execute('INSTALL iceberg')"
```

Reader calls at runtime only do `LOAD sqlite; LOAD iceberg;` — no
network dependency.

## Why This Works

Between 1.1.3 (Nov 2024) and 1.5.2 the DuckDB Iceberg extension grew
substantial reader coverage:

- In 1.1.3 the extension fails when any field in the Iceberg table's schema
  has a structural shape the parser doesn't recognize — the "Invalid field
  found while parsing field: type" error is an internal failure during
  Iceberg schema parsing, not a data error. `configurations` has nested
  `properties` (Map type) and `location_crosswalks` similarly; 1.1.3 can't
  parse those.
- In 1.5 the extension handles the full Iceberg v2 spec including
  partitioned tables, nested types, geometry columns, and tz-aware
  timestamps (with `pytz`).

The 30-minute spike against `/home/aquagio/ngiab/local/` (a real teehr 0.6.2
warehouse) was the decisive evidence — catalog attach and table enumeration
worked fine in 1.1.3; the failure was per-table `iceberg_scan` for the tables
with complex schemas.

## Prevention

### 1. Spike new dep reader paths against real producer output BEFORE pinning

The plan's original decision was "DuckDB 1.1.3 stays (no bump in this plan)."
A 30-minute spike flipped that — the 1.1.3 reader demonstrably couldn't open
what teehr 0.6.2 writes. Running the spike before committing the pin would
have saved writing a reader module whose first half assumed the wrong
version.

The recipe:

```bash
# 1. Produce a real fixture with the pinned producer
./ngiab-teehr/runTeehr.sh -d <input> -t <pinned-tag>

# 2. Run a minimal reader in the client's pinned Python env
docker run --rm -v /tmp/spike.py:/tmp/spike.py -v <warehouse>:<warehouse> \
    python:3.12-slim bash -c "pip install duckdb==<pin> pytz && python /tmp/spike.py"

# 3. Assert every table the client needs actually reads
```

### 2. Pre-install extensions at image build time

`INSTALL iceberg` at first use triggers an HTTPS fetch to
`extensions.duckdb.org`. Air-gapped / restricted-egress deployments fail
silently with confusing IO errors. Build-time `INSTALL` bakes the extension
into the image so runtime only does `LOAD` (a local-filesystem op).

### 3. Lock the extension version alongside DuckDB version

`INSTALL iceberg` at runtime pulls whatever `extensions.duckdb.org` serves
THAT DAY. If a future server-side change ships a backward-incompatible
extension, pinned-DuckDB-version isn't enough to protect the client.
Build-time install with the pinned DuckDB version pins the extension too.

### 4. Watch for "pytz required" errors after DuckDB upgrades

DuckDB 1.5's timestamp-with-timezone decoding silently requires `pytz` to
be importable (not just installed — importable in the same Python env).
Omit `pytz` from the deps and `iceberg_scan` on any table with a tz-aware
datetime column raises `Required module 'pytz' failed to import`. Add pytz
explicitly in `pyproject.toml` so it survives lock regeneration.

## Related Issues

- ngiab-client plan (local): `docs/plans/2026-04-20-001-feat-teehr-warehouse-compatibility-plan.md`
  §Verified documents the full empirical comparison (1.1.3 vs 1.5.2).
- Related learning: `docs/solutions/integration-issues/teehr-api-timeseries-type-rename-2026-04-21.md`
  (producer-side teehr version bump).
- Related pattern: `docs/solutions/best-practices/reading-teehr-iceberg-warehouse-with-duckdb-2026-04-21.md`
  (full reader design including mount-path mirroring and snapshot isolation).
