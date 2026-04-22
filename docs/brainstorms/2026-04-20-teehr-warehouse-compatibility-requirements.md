# TEEHR Warehouse Compatibility -- Requirements

**Date:** 2026-04-20
**Status:** Ready for planning -- all open decisions resolved (see §Open Decisions)
**Driver:** `ngiab-teehr` PR #8 (`7-update-to-latest-teehr-version`) introduces a new TEEHR output layout that breaks the NGIAB visualizer. The visualizer must be updated to read the new layout.

## Context

`ngiab-teehr` is moving from per-run parquet/CSV output inside each model-run folder to a shared **warehouse** directory (`ngiab_teehr_warehouse/`) whose internal layout is:

- A **SQLite-backed Apache Iceberg JDBC catalog** at `local/local_catalog.db`. This file holds **only** metadata pointers (an `iceberg_tables` row per table with a `metadata_location` column pointing at an absolute path to a `metadata/*.json` snapshot). The table data is not inside the `.db` file.
- **Iceberg-format parquet tables** under `local/teehr/<table>/{data,metadata}/`. `data/` contains partitioned parquet files; `metadata/` contains snapshot `.json` files + manifest-list and manifest `.avro` files. All three file types (catalog row, `.json`, `.avro`) embed absolute host paths.
- A TEEHR semver `version` file at `<warehouse>/local/version` (written by the TEEHR SDK as `teehr.__version__` on warehouse creation).

The warehouse is populated by a new container invocation that takes `--data_folder_stem` and `--teehr_evaluation_dir`.

### Term: "sanitized configuration name"

Throughout this document, the **sanitized configuration name** refers to a run's basename transformed by:

```python
re.sub(r"[^a-zA-Z0-9_]", "_", basename).lower()
```

The teehr script prefixes this with `ngen_` to produce the full `configuration_name` (e.g. `AWI_16_2863657_007` -> `ngen_awi_16_2863657_007`).

The visualizer (`tethysapp/ngiab/utils.py`) currently assumes TEEHR output lives at `<model_run>/teehr/` and reads specific files (`metrics.csv`, `ngen_usgs_crosswalk.parquet`, `nwm_usgs_crosswalk.parquet`, `dataset/joined_timeseries/configuration_name=.../variable_name=.../*.parquet`). **Those paths no longer exist after PR #8. Notably, `joined_timeseries` is NOT persisted in the new warehouse -- it is computed as a Spark view at query time by TEEHR's `joined_timeseries_view()`. Only `ngen_metrics` is materialized.**

### New warehouse layout (corrected from PR screenshot + teehr source inspection)
```
ngiab_teehr_warehouse/
├── local/
│   ├── cache/
│   │   ├── loading/secondary_timeseries/
│   │   └── ngen_output/                      # per-run ngen output staging (pre-load)
│   ├── local_catalog.db                      # SQLite; Iceberg JDBC catalog (iceberg_tables only)
│   ├── version                               # TEEHR semver (e.g. "0.6.0")
│   ├── schema_evolution/schema_version_history/{data,metadata}
│   └── teehr/                                # Iceberg tables: data/ = partitioned parquet; metadata/ = *.json + *.avro
│       ├── attributes/metadata
│       ├── configurations/{data,metadata}
│       ├── location_attributes/metadata
│       ├── location_crosswalks/{data,metadata}   # replaces ngen_usgs_crosswalk.parquet + nwm_usgs_crosswalk.parquet
│       ├── locations/{data,metadata}
│       ├── ngen_metrics/{data,metadata}      # replaces metrics.csv (only materialized metrics table)
│       ├── primary_timeseries/{data,metadata}    # USGS observations
│       ├── secondary_timeseries/{data,metadata}  # ngen_<sanitized_configuration_name> + nwm30_retrospective
│       ├── units/{data,metadata}
│       └── variables/{data,metadata}
└── teehr.log
```

Note: earlier drafts placed `version` at the warehouse root. It is actually at `local/version` per `teehr.evaluation.evaluation.py:787-789`.

## Goal

Unbreak the visualizer against the new `ngiab-teehr` output while preserving today's user experience. Architectural decisions required before planning starts are listed in §Open Decisions.

---

## Open Decisions (Blocking Planning)

These were surfaced in document review and require user/stakeholder judgment before FR3/FR5/FR7 can be written with confidence.

### OD1 -- Reader strategy (RESOLVED)

**Decision:** DuckDB `sqlite_scanner` + `iceberg_scan(metadata_location)` per table. No new Python runtime dep.

Flow inside `teehr_warehouse.py`:
1. Open `<warehouse>/local/local_catalog.db` via DuckDB's `sqlite_scanner` (read-only).
2. Read `iceberg_tables` to get `(table_namespace, table_name) -> metadata_location` for each teehr table we need (`configurations`, `locations`, `location_crosswalks`, `primary_timeseries`, `secondary_timeseries`, `ngen_metrics`).
3. Call `iceberg_scan(metadata_location, allow_moved_paths=true)` per table to get a DuckDB view.
4. Execute joins / filters / pivots against those views.
5. Re-read the catalog on each top-level call (never cache `metadata_location` across requests) so we pick up snapshot commits from concurrent teehr runs.

**Open sub-decision (defer to planning):** whether to bump DuckDB 1.1.3 -> 1.5. Not required for the above flow, but 1.5 has a direct Iceberg REST-catalog attach that could simplify the catalog walk if we later adopt a non-SQLite catalog. Bump is a regression-test surface since `utils.py` uses DuckDB throughout.

### OD2 -- `joined_timeseries` computation (RESOLVED, follows from OD1)

The new warehouse does not materialize `joined_timeseries` -- teehr computes it as a Spark view at query time via `joined_timeseries_view()`. Since OD1 is DuckDB, we **re-implement the join in DuckDB** inside `get_joined_timeseries`.

**Drift-risk mitigation (required in planning):**
- Mirror teehr's join shape from `teehr/evaluation/views/joined_timeseries_view.py` (variable-name parse, null-safe equality, crosswalk join). Comment the SQL with a reference to the teehr source version it was cribbed from.
- Add an integration test that runs TEEHR against a fixture dataset, reads both the `ngen_metrics` table (teehr-authoritative) and our in-DuckDB join result, recomputes the same 4 metrics (KGE, NSE, RBias, RMSDR) in pandas from our join, and asserts they match `ngen_metrics` within a tight tolerance. Any future drift from teehr's join semantics surfaces as a test failure rather than silently wrong charts.
- Treat the test fixture as the "supported teehr version" anchor -- bumping the pinned `awiciroh/ngiab-teehr` tag requires re-running the fixture and updating snapshots.

### OD3 -- Cross-run comparison (RESOLVED)

**Decision:** Minimal scaffolding in this release + committed follow-up issue.

In-release scope (no endpoint-contract change):
- `teehrSelect` groups dropdown entries under a "This run" heading. An empty "Other runs" heading renders as a disabled/placeholder item, signalling that other runs' data lives in the same warehouse and will be selectable in a future release.
- Each dropdown entry's label is prefixed with the run-id source (e.g. "ngen * AWI_16_2863657_007"), so the pattern matches when other-run entries get added.

Follow-up (separate issue, not in this release):
- Multi-select dropdown, N-series chart, per-configuration metrics rows, backend filter relaxation.
- File a GitHub issue with acceptance criteria, link it from the Non-Goals section when this doc moves to a plan.

### OD4 -- Hard cutover on pre-PR TEEHR output (RESOLVED)

**Decision:** Hard cutover. No legacy reader. Users with pre-PR TEEHR output must re-run TEEHR with the new image to regain visualization.

Old-layout detection (`<run>/teehr/metrics.csv` present) still triggers the `teehr_status` "legacy output; re-run with current image" hint (FR6) so the user understands what happened and what to do. But no code path reads the old files.

### OD5 -- Per-run `teehr_evaluation_dir` JSON field (RESOLVED)

**Decision:** Drop it. Env-var-only discovery.

- `ngiab_visualizer.json` gains only `teehr_configuration_name` per run, not `teehr_evaluation_dir`.
- The backend resolves the warehouse solely from `TEEHR_WAREHOUSE_PATH` (set by `viewOnTethys.sh`).
- The `teehr_run_manifest.json` schema still emits the `teehr_evaluation_dir` field (cheap, informational, useful for debugging and for the future cross-run feature), but `viewOnTethys.sh` does not copy it into the registry.
- Decision can be revisited when the cross-run follow-up (OD3) is picked up; at that point a per-run override may be justified.

### OD6 -- Run-basename collision handling (RESOLVED)

**Decision:** Detect + warn in `NGIAB-CloudInfra/runTeehr.sh` before invoking the teehr container.

Rationale: the shared warehouse introduces a new failure mode (two model runs with the same basename produce the same `ngen_<sanitized>` and the second run's `secondary_timeseries` write appends to the first's, producing mixed metrics over merged data). This was not a problem in the old per-run teehr/ layout. The cheapest early-detection point is at `runTeehr.sh` time, before data is written.

In-scope:
- Before launching the teehr container, `runTeehr.sh` queries the warehouse's `configurations` table (via the same DuckDB reader path introduced in FR3, or via a tiny shell-side sqlite3 query for zero Python dep) for `ngen_<sanitized>`. If a matching configuration exists and was written by a different model run (checked via `teehr_run_manifest.json` timestamps and the `data_folder_path` recorded inside the manifest), warn the user with the prior run's identifier and prompt for explicit confirmation to proceed (overwrite/append) or cancel.
- `--force` / `-f` flag skips the prompt for automated/CI runs.

Out of scope for this release:
- Automatic uniqueness suffixes (timestamp/UUID) -- rejected because it breaks the 1:1 basename↔stem mapping the rest of the system relies on.
- Visualizer-side detection (via manifest timestamp comparison) -- rejected as too late; the data is already mixed by the time the user sees it. May revisit if users report bypassing the `runTeehr.sh` prompt.

---

## Decisions Resolved

### 1. Warehouse layout and discovery
**Decision:** Shared warehouse outside model-run directories, reachable via a second Docker volume mount.
- `NGIAB-CloudInfra/viewOnTethys.sh` adds a second `-v` mount for the warehouse path alongside the existing `MODELS_RUNS_DIRECTORY` mount, and sets an env var `TEEHR_WAREHOUSE_PATH` pointing at the in-container mount point.
- `ngiab_visualizer.json` gains per-run field `teehr_configuration_name` (the exact `ngen_<sanitized_configuration_name>` value). Whether `teehr_evaluation_dir` is also stored depends on OD5.
- If no JSON field is set, the backend falls back to `TEEHR_WAREHOUSE_PATH` env.

**Rationale:** Preserves teehr's cross-run design (one warehouse, many runs) with minimal registry churn. Cross-run comparison is disabled at the query layer for this release (see OD3).

### 2. Read strategy
**See OD1.** Previous "DuckDB directly on `local_catalog.db`" is invalid; reader strategy must be re-chosen. Whichever option is selected, format knowledge MUST be isolated in a new module `tethysapp/ngiab/teehr_warehouse.py` so any future teehr format shift is a localized rewrite.

### 3. Config scope in the TEEHR dropdown
**Decision:** Scope to the selected run's own configurations (subject to OD3 revisitation).
- Backend filters `configuration_name IN ('ngen_<this_run_sanitized_configuration_name>', 'nwm30_retrospective')`.
- Minimal React changes: `teehrSelect` gains a `teehr_status` hint (see FR6).

### 4. Backward compatibility with pre-PR teehr output
**See OD4.** Previously "hard cutover." Reconsider in light of scientific-reproducibility impact.

### 5. Empty states
`getTeehrVariables` returns `{"teehr_variables": <list>, "teehr_status": <string|null>}`. See FR6 for the full state enumeration.

---

## Functional Requirements

Grouped by concern.

### Infrastructure

#### FR1 -- Shared-warehouse mount wiring
- `NGIAB-CloudInfra/viewOnTethys.sh` mounts the warehouse directory into the Tethys container and exposes the in-container path to Django as env var `TEEHR_WAREHOUSE_PATH`.
- **Mount path mirroring (hard requirement):** The warehouse MUST be mounted at the same absolute path in the Tethys container as in the teehr container. Absolute paths are embedded in (a) `iceberg_tables.metadata_location` in `local_catalog.db`, (b) every `metadata/*.json` snapshot, and (c) every `metadata/*.avro` manifest file. Mirror example: `-v /home/<user>/ngiab_teehr_warehouse:/home/<user>/ngiab_teehr_warehouse`.
- **Supported hosts (initial release):** Linux and WSL2 only. Docker Desktop on Windows (pure Windows paths) and macOS host-path translation are out of scope -- the path-mirroring constraint is not reliably satisfiable there without a path-rewriting step analogous to TEEHR's own `import_evaluation.py`. Document this limitation in the user-facing README.
- **Mount mode:** Read-write. SQLite WAL requires writable `-wal`/`-shm` sidecars in the directory; DuckDB may spill temp files. The visualizer process itself MUST NOT issue writes to `local_catalog.db` or Iceberg data/metadata; this is enforced at the code level (read-only DuckDB/pyiceberg connections), not at the mount level. Document "do not run teehr and the visualizer concurrently" until concurrency is validated.
- **Singularity:** `singularity/` and `singularity_tethys_ngiab.def` exist in this repo; equivalent bind-mount mirroring must be added as a follow-up item, not in initial release.

#### FR7 -- Manifest + `runTeehr.sh` updates (cross-repo)

**Ownership:** `ngiab-teehr` repo (producer) owns manifest emission; `NGIAB-CloudInfra` (orchestrator) owns reading it.

- **`ngiab-teehr/scripts/teehr_ngen.py`** -- on successful completion, writes `teehr_run_manifest.json` into `/app/data/` (= the host model-run directory) containing at minimum:
  ```json
  {
    "manifest_version": 1,
    "teehr_configuration_name": "ngen_<sanitized>",
    "teehr_evaluation_dir": "/absolute/host/path/to/warehouse",
    "teehr_image_tag": "awiciroh/ngiab-teehr:<tag>",
    "teehr_package_version": "0.6.0"
  }
  ```
- **`NGIAB-CloudInfra/runTeehr.sh`** -- update container invocation to pass `--data_folder_stem` and `--teehr_evaluation_dir`; use the mirrored-path mount rule.
- **`NGIAB-CloudInfra/viewOnTethys.sh`** -- during `add_model_run`, read `teehr_run_manifest.json` from the run directory (if present) and persist `teehr_configuration_name` into `ngiab_visualizer.json`. Malformed-manifest handling: if parse fails, log a warning and fall through to the FR2 fallback.
- `awiciroh/ngiab-teehr` image tag is pinned in `runTeehr.sh` to a version this client was tested against.

### Data and queries

#### FR2 -- Run-to-configuration mapping
- **Primary path:** The teehr container writes `teehr_run_manifest.json` (FR7). When `viewOnTethys.sh` registers the run, it persists `teehr_configuration_name` into `ngiab_visualizer.json`.
- **Fallback (manifest absent):** Derive `ngen_` + `re.sub(r"[^a-zA-Z0-9_]", "_", basename).lower()` from the registered run's `path` and validate by querying the warehouse's `configurations` table. If no match, treat as "no evaluation."
- **Precedence rule (explicit):** The persisted `teehr_configuration_name` is authoritative. If the user renamed the run via the "Duplicate" flow in `copy_models_run`, the persisted value still maps correctly; the fallback is NEVER used to overrule a persisted value.
- **`runTeehr.sh`-after-`viewOnTethys.sh` ordering:** If a user registers a run, then runs TEEHR, then reopens the visualizer, the manifest was not present at registration. The backend MUST apply the fallback derivation path at query time (not only at registration time) so the late-arriving evaluation becomes visible without re-registration. The user-visible workflow is "refresh the page."

#### FR3 -- Backend reader module (`tethysapp/ngiab/teehr_warehouse.py`)

**Scope dependent on OD1.** Whichever strategy is chosen, exposes:

- `list_configurations_for_run(config_name) -> list[{value,label}]`
- `get_joined_timeseries(config_name, variable_name, usgs_location_id) -> list of series` -- see OD2 for how this is computed
- `get_metrics_for_location(config_name, usgs_location_id) -> list[dict]` (read `ngen_metrics`)
- `usgs_for_ngen(config_name, ngen_id) -> str | None` (read `location_crosswalks`)
- `list_usgs_locations_for_run(config_name) -> list[str]`

All catalog-format knowledge is contained in this module.

### API and compatibility

#### FR4 -- Controller / API compatibility
- `getTeehrVariables`, `getTeehrTimeSeries`, and endpoints consuming `append_ngen_usgs_column` keep existing JSON keys/shapes unchanged.
- The only additive change is the new optional `teehr_status` field on `getTeehrVariables`.

#### FR6 -- Empty-state UX (expanded)

- `getTeehrVariables` response is always `{"teehr_variables": <list>, "teehr_status": <string|null>, "teehr_status_severity": "info"|"warning"|"error"|null}`.
- `teehr_status` is `null` when at least one configuration/variable pair was returned.
- Otherwise, `teehr_status` is one of the following user-facing strings, chosen by backend detection order:

  | Condition | String | Severity |
  |---|---|---|
  | No warehouse mount: `TEEHR_WAREHOUSE_PATH` unset AND no per-run override | "TEEHR warehouse is not configured. See setup docs." | info |
  | Warehouse path exists but `local/local_catalog.db` missing | "TEEHR warehouse appears empty. Run TEEHR to populate it." | info |
  | Catalog present, `iceberg_tables` has zero rows | "TEEHR warehouse contains no evaluations yet." | info |
  | Version check fails (file missing / outside supported TEEHR version) | "TEEHR warehouse was written by an unsupported TEEHR version." | warning |
  | Old-layout files detected at `<run>/teehr/metrics.csv` | "This run has legacy TEEHR output. Re-run TEEHR with the current image to view results." | warning |
  | Configuration for this run not present in warehouse | "No TEEHR evaluation found for this run." | info |
  | Configuration present but `metadata_location` path unreadable (mount-mirror mismatch, permission) | "TEEHR warehouse files are not reachable. Check the mount configuration." | error |
  | Configuration present, no USGS crosswalk for the clicked location | "No USGS gauge is linked to this location." | info |
  | Configuration + data exist but `ngen_metrics` is empty for this location | "Metrics not yet available for this location." | info |

- **React / Redux changes:**
  - Add `status: { message: string | null, severity: string | null }` to the `teehr` slice in `hydroFabricReducer.js`.
  - `reset_teehr` action clears it.
  - `teehrSelect` component: render the TEEHR section label and hint region **outside** the existing `{state.teehr.id && ...}` conditional, so the hint is visible even when the dropdown has no options. The dropdown control itself remains gated.
  - `getTeehrTimeSeries` error path: use `toast.error(...)` (matching `trouteSelect.js:61`), AND set `teehr.status` to a persistent hint so the user can re-read it after the toast fades.

### Safety and versioning

#### FR5 -- Warehouse-version safety
- Read `<warehouse>/local/version` (NOT `<warehouse>/version`) on first access. File contents are the TEEHR package semver (e.g. `0.6.0`).
- Supported range is declared as a pinned compatibility bound in `teehr_warehouse.py` tracking what the client has been tested against (e.g. `>=0.6.0,<0.7`). This range moves in lockstep with the pinned `awiciroh/ngiab-teehr` tag in `runTeehr.sh`; bumping one without the other requires a conscious code change.
- On out-of-range: `teehr_status` is set to the "unsupported TEEHR version" string, `teehr_variables` is empty, no backend stack trace.

---

## Non-Goals / Follow-ups

- **Full cross-run comparison UI** (multi-select, N-series chart, per-configuration metrics rows) -- deferred. Minimal scaffolding ships in this release per OD3; file a tracking issue with acceptance criteria at planning time.
- **Embedding the TEEHR Python SDK in the visualizer image** -- rejected (OD1); DuckDB + sqlite_scanner + iceberg_scan instead.
- **Dual-reader backward compatibility with pre-PR TEEHR output** -- rejected (OD4). Users re-run TEEHR.
- **Per-run `teehr_evaluation_dir` override in `ngiab_visualizer.json`** -- rejected for now (OD5). Revisit when cross-run is picked up.
- **Windows (Docker Desktop pure-Windows path) and macOS host-path-translation support for the warehouse mount** -- deferred; supported hosts are Linux and WSL2 in this release.
- **Singularity parity with the second warehouse mount** -- follow-up.
- **Warehouse writes from the client** (saved comparisons, annotations, materialized cached derived tables) -- explicitly out of scope; future features of this kind will require a separate client-side store, not warehouse writes.
- **Automatic uniqueness suffixes for basename collisions** -- rejected (OD6); runTeehr.sh prompts the user instead.

## Success Criteria

- Running `ngiab-teehr` (post-PR #8) against a model run and then opening the visualizer produces: dropdown populated, chart rendered, metrics panel populated.
- Selecting a run with no teehr evaluation shows the correct `teehr_status` message from the FR6 table; no stack trace; no broken panel.
- Selecting a run whose warehouse cannot be reached (mount-mirror violation) shows the "files not reachable" message (severity `error`).
- A user who registers a run, then runs TEEHR, then refreshes the page, sees results without re-registering.
- The visualizer image builds on Linux and runs the warehouse reader against a warehouse the user produced with the pinned teehr image tag.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| TEEHR on-disk format changes between releases (including patch releases that apply schema migrations on warehouse open) | High | Pin `awiciroh/ngiab-teehr` tag; check `<warehouse>/local/version` on load; isolate all format knowledge in `teehr_warehouse.py`; test at each tag bump |
| Joined-timeseries semantics drift if re-implemented in DuckDB/pyiceberg rather than delegated to TEEHR or persisted at producer | High | See OD2 |
| Run id vs teehr configuration name drift (Duplicate flow, two runs with same basename) | High | Persist `teehr_configuration_name` via FR2 manifest flow; OD6 for collision policy |
| Mount mirroring violated (Docker Desktop host-path translation, symlinks, laptop-to-NFS move) | High | FR1 supported-host scoping; FR6 "files not reachable" status; TEEHR's own `import_evaluation.py` exists as precedent for path-rewrite if scope expands |
| `local_catalog.db` + Iceberg concurrent access with writer (teehr) and reader (visualizer) | Medium | Reader uses read-only SQLite + Iceberg connections; re-read catalog per query to avoid stale metadata_location; document "don't run teehr and visualize concurrently" until validated |
| Users running the new visualizer against an old warehouse layout | Medium | Detect old `<run>/teehr/metrics.csv` -> FR6 "legacy output" hint |
| Sanitization rule drift between teehr and client (teehr changes the rule) | Medium | Manifest is the source of truth; client-side sanitization is fallback-only and time-bounded (sunset when all pre-manifest runs have been re-registered) |
| Warehouse mount path A cached across switch to path B within one process | Medium | Reader module keys connections by warehouse path; evict on path change; no module-level DuckDB connection singletons |

## Affected Files (for planning)

**`ngiab-client` repo:**
- `tethysapp/ngiab/utils.py` -- replace TEEHR read helpers (L80-142 for `append_ngen_usgs_column`; L309-520 for readers) with calls into the new module
- `tethysapp/ngiab/controllers.py` -- `getTeehrTimeSeries`, `getTeehrVariables` wire-up; populate `teehr_status` + `teehr_status_severity`
- `tethysapp/ngiab/teehr_warehouse.py` *(new)* -- warehouse reader; contents driven by OD1
- `reactapp/features/hydroFabric/components/teehrSelect.js` -- render hint region outside `state.teehr.id` gate; consume `teehr.status`; add "This run" / "Other runs" grouping with the "Other runs" heading rendering as a disabled placeholder (OD3 scaffolding); prefix entry labels with source run id
- `reactapp/features/hydroFabric/store/reducers/hydroFabricReducer.js` -- add `status` to `teehr` slice; handle in `reset_teehr`
- `reactapp/features/hydroFabric/store/actions/actionsTypes.js` -- new action types if needed
- `pyproject.toml` / `pdm.lock` -- no new deps required for OD1-A; DuckDB 1.1.3 -> 1.5 bump is an optional sub-decision deferred to planning

**`NGIAB-CloudInfra` repo:**
- `viewOnTethys.sh` -- second mirrored-path volume mount; set `TEEHR_WAREHOUSE_PATH`; read `teehr_run_manifest.json` during `add_model_run` and copy `teehr_configuration_name` only (per OD5) into `ngiab_visualizer.json`
- `runTeehr.sh` -- new container interface (`--data_folder_stem`, `--teehr_evaluation_dir`, mirrored-path mount); pinned image tag; pre-flight collision check against warehouse `configurations` with confirm prompt and `--force` flag (OD6)

**`ngiab-teehr` repo:**
- `scripts/teehr_ngen.py` -- emit `teehr_run_manifest.json` on success; possibly persist `joined_timeseries` (driven by OD2)
