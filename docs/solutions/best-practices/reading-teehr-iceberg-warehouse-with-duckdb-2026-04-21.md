---
title: Reading a TEEHR SQLite-JDBC Iceberg warehouse with DuckDB
date: 2026-04-21
category: best-practices
module: ngiab-client
problem_type: best_practice
component: database
severity: medium
applies_when:
  - "A Python/Django service needs read-only access to a TEEHR warehouse written by ngiab-teehr"
  - "Avoiding the TEEHR SDK (Spark + JVM) as a client dep is a goal"
  - "DuckDB is already in the stack and 1.5+ is acceptable"
  - "Warehouse is co-located on disk (Linux/WSL2 host; Docker bind-mount)"
tags:
  - teehr
  - duckdb
  - iceberg
  - sqlite
  - read-only
  - docker-mount
  - snapshot-isolation
---

# Reading a TEEHR SQLite-JDBC Iceberg warehouse with DuckDB

## Context

TEEHR (`ngiab-teehr`) writes its warehouse as an Apache Iceberg table set
fronted by a SQLite-backed JDBC catalog. A Python consumer (e.g. the
`ngiab-client` Django visualizer) that wants to read this warehouse has
three plausible paths: embed the TEEHR SDK (Spark + JVM, heavy),
embed `pyiceberg` (one Python dep), or use DuckDB's built-in `sqlite_scanner`
+ `iceberg_scan` extensions. Only the DuckDB path adds zero new Python deps
to a codebase that already uses DuckDB elsewhere.

This doc describes the working pattern plus the four gotchas that cost a
meaningful amount of the implementation budget when it was first built.

## Guidance

### 1. Warehouse on-disk shape (verify against your teehr version)

```
<warehouse_path>/local/
├── local_catalog.db          # SQLite JDBC Iceberg catalog (metadata pointers only)
├── version                   # TEEHR package semver, e.g. "0.6.2"
├── cache/                    # per-run ngen_output staging
├── schema_evolution/...
└── teehr/                    # Iceberg tables
    ├── configurations/
    ├── locations/
    ├── location_crosswalks/
    ├── primary_timeseries/
    ├── secondary_timeseries/
    ├── ngen_metrics/
    ├── attributes/
    ├── location_attributes/
    ├── units/
    └── variables/
```

Each table dir contains `data/` (partitioned parquet) and `metadata/` (Iceberg
`.metadata.json` + `.avro` manifests). **All three metadata surfaces (the
SQLite `.db`, the `.json` snapshots, the `.avro` manifests) embed absolute
host paths** — that's the source of the mount-mirroring requirement below.

### 2. Reader skeleton

```python
import duckdb
from packaging.specifiers import SpecifierSet
from packaging.version import Version

SUPPORTED_TEEHR_VERSIONS = SpecifierSet(">=0.6.0,<0.7.0")

class WarehouseReader:
    def __init__(self, warehouse_path):
        self.warehouse_path = Path(warehouse_path)
        self._verify_version()  # read local/version, raise if out of range
        self._conn = duckdb.connect(":memory:")
        # Extensions are pre-installed at image build time; only LOAD here.
        self._conn.execute("LOAD sqlite")
        self._conn.execute("LOAD iceberg")
        self._conn.execute(
            f"ATTACH '{self.warehouse_path}/local/local_catalog.db' "
            f"AS cat (TYPE sqlite, READ_ONLY)"
        )

    def _freeze_catalog(self):
        # Read the full iceberg_tables snapshot ONCE per public method call
        # (not once per table access) — see Gotcha 3 below.
        rows = self._conn.execute(
            "SELECT table_name, metadata_location "
            "FROM cat.iceberg_tables "
            "WHERE table_namespace = 'teehr'"
        ).fetchall()
        return {name: location for name, location in rows}

    def list_configurations(self, config_name):
        catalog = self._freeze_catalog()
        rows = self._conn.execute(
            f"SELECT DISTINCT configuration_name, variable_name "
            f"FROM iceberg_scan('{catalog['secondary_timeseries']}') "
            f"WHERE configuration_name = ?",
            [config_name],
        ).fetchall()
        return rows
```

A join across multiple Iceberg tables looks like:

```python
sql = f"""
SELECT p.value_time, p.value AS primary_value, s.value AS secondary_value
FROM iceberg_scan('{catalog['primary_timeseries']}') p
JOIN iceberg_scan('{catalog['location_crosswalks']}') x
  ON x.primary_location_id = p.location_id
JOIN iceberg_scan('{catalog['secondary_timeseries']}') s
  ON s.location_id = x.secondary_location_id
 AND s.value_time  = p.value_time
 AND s.variable_name = p.variable_name
WHERE p.location_id = ?
  AND p.variable_name = ?
  AND s.configuration_name = ?
"""
```

### 3. Docker mount path MUST mirror the host path

Iceberg embeds absolute host paths in `iceberg_tables.metadata_location`, in
the snapshot `.metadata.json` files, and in the `.avro` manifests. If the
consumer container mounts the warehouse at a different path than where teehr
wrote it, every `iceberg_scan` call fails with `IOException: No such file`.

```yaml
# producer side (ngiab-teehr runTeehr.sh):
# -v "$TEEHR_EVALUATION_DIR:$TEEHR_EVALUATION_DIR"

# consumer side (ngiab-client viewOnTethys.sh):
# -v "$TEEHR_WAREHOUSE_PATH:$TEEHR_WAREHOUSE_PATH:ro"
```

Use the **exact same absolute path on both sides**. This constraint is
Linux/WSL2-only in practice — Docker Desktop on Windows (pure-NTFS paths)
and macOS (gRPC-mediated path translation) don't reliably mirror.

### 4. Required deps

```toml
# pyproject.toml
dependencies = [
    "duckdb>=1.5,<1.6",  # 1.1.3 fails on certain teehr tables — see related doc
    "pytz",              # DuckDB 1.5 uses pytz for tz-aware timestamps
    # ... your other deps ...
]
```

`pyiceberg` is NOT required with this pattern. DuckDB's iceberg extension
does the parsing.

```dockerfile
# Dockerfile -- pre-install at image build so runtime LOAD is network-free
RUN python -c "import duckdb; c=duckdb.connect(); \
    c.execute('INSTALL sqlite'); c.execute('INSTALL iceberg')"
```

## Why This Matters

**Avoids embedding the TEEHR SDK in the consumer.** teehr pulls in Spark,
PySpark, a JVM, and pyarrow — a material image bloat for a service that
only needs to read a handful of tables. DuckDB is already a common Python
data stack dep; Iceberg reading is a library feature, not a whole runtime.

**Zero join-semantics abstraction.** Pyspark joins go through Catalyst;
DuckDB joins go through DuckDB's planner. If you're computing metrics from
the join result, you need to verify your join matches teehr's `joined_timeseries_view()`
within tolerance (see "Verify with a drift guard" below).

**Catches format drift early.** Reading via DuckDB means a teehr-side
schema change surfaces as a DuckDB parse error immediately on open, not as
silently-wrong metrics on a chart.

## When to Apply

- Django/Python consumer where adding Spark is out of the question.
- Visualizer or analytical tool that only reads (never writes) the warehouse.
- DuckDB 1.5+ is acceptable — 1.1.3 cannot read 3 of the 5 critical tables
  (see `docs/solutions/integration-issues/duckdb-1-1-3-cannot-read-teehr-iceberg-2026-04-21.md`).
- Deployment supports bind-mount mirroring (Linux/WSL2 host + Docker).

If any of those don't hold, reconsider: pyiceberg is a good alternative on
the "no Spark, no DuckDB version floor" axis; the TEEHR SDK is the right
choice when you want teehr's own `joined_timeseries_view()` semantics
verbatim.

## Examples

### Gotcha 1 — `allow_moved_paths=true` does NOT work on direct `.metadata.json` paths

```python
# WRONG (and what DuckDB docs examples show first):
iceberg_scan('/abs/path/to/metadata/00001-abc.metadata.json', allow_moved_paths=true)
# -> InvalidInputException: Enabling allow_moved_paths is not enabled for
#    directly scanning metadata files.

# RIGHT: omit the flag entirely. metadata_location already points at a
# specific snapshot; no path-moving detection is useful there.
iceberg_scan('/abs/path/to/metadata/00001-abc.metadata.json')
```

If you need the `allow_moved_paths` behavior, you'd have to derive the table
root from the metadata path — a refactor that's rarely justified when the
mirror-mount approach already solves the path-location problem.

### Gotcha 2 — Catalog is a `jdbc` SQLite, not a DuckDB database

`local_catalog.db` is **SQLite in JDBC-catalog layout** (the `iceberg_tables`
table holds `(table_namespace, table_name, metadata_location)` pointers).
DuckDB's `sqlite_scanner` reads it; DuckDB's native `ATTACH` on it would
interpret it as a DuckDB DB and fail.

```python
# RIGHT:
con.execute("ATTACH '<path>' AS cat (TYPE sqlite, READ_ONLY)")
con.execute("SELECT metadata_location FROM cat.iceberg_tables WHERE ...")
```

### Gotcha 3 — Freeze the catalog snapshot PER METHOD, not per access

If a method calls `iceberg_scan` against multiple tables (a join), every
call should use `metadata_location` values read from the catalog in a
single query at method entry. Re-reading `iceberg_tables` between scans
means a concurrent teehr write could bump one table's snapshot pointer
between reads — producing a join across incompatible Iceberg snapshots and
silently wrong results.

```python
def get_joined_timeseries(self, ...):
    catalog = self._freeze_catalog()  # ONCE, at method entry
    sql = f"""
        ... iceberg_scan('{catalog['primary_timeseries']}') p
        JOIN iceberg_scan('{catalog['location_crosswalks']}') x ...
        JOIN iceberg_scan('{catalog['secondary_timeseries']}') s ...
    """
```

### Gotcha 4 — Verify with a drift guard when re-implementing joins

teehr's `joined_timeseries_view()` has non-trivial semantics (variable-name
parsing, null-safe equality, crosswalk joins). Re-implementing it in DuckDB
means your SQL might drift from teehr's over time.

Lock your join against teehr's authoritative `ngen_metrics` table: recompute
the four standard metrics (KGE, NSE, RelativeBias, RMSDR) from your join in
pandas, and assert they match teehr's metrics within empirically-calibrated
tolerance:

```python
def test_drift_guard(reader):
    loc = ...  # a USGS id with non-empty ngen_metrics
    teehr_metrics = reader.get_metrics_for_location("ngen_<stem>", loc)

    # Our join
    series = reader.get_joined_timeseries(
        "ngen_<stem>", "streamflow_hourly_inst", loc
    )
    primary = [pt["y"] for pt in series[0]["data"]]
    secondary = [pt["y"] for pt in series[1]["data"]]

    # Recompute the 4 metrics and compare within tolerance
    # (rtol=1e-4, atol=1e-7 are reasonable starting points;
    # calibrate once against the fixture and lock the observed drift).
    ...
```

Spark (teehr) and DuckDB+pandas (our side) accumulate float sums in
different orders; KGE/NSE drift of `1e-5` to `1e-4` is normal. Setting a
flat `1e-6` tolerance will produce flaky tests; calibrate empirically.

## Related

- `docs/solutions/integration-issues/duckdb-1-1-3-cannot-read-teehr-iceberg-2026-04-21.md`
  — why DuckDB 1.1.3 is insufficient.
- `docs/solutions/integration-issues/teehr-api-timeseries-type-rename-2026-04-21.md`
  — why teehr 0.6.0 can't even produce a working warehouse against the
  current API; 0.6.2+ required.
- DuckDB Iceberg docs: https://duckdb.org/docs/current/core_extensions/iceberg/overview.html
- Upstream `teehr/evaluation/views/joined_timeseries_view.py` — the reference
  implementation for anyone re-implementing the join.
