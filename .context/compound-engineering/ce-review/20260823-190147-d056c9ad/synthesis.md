# ce:review autofix run — 20260823-190147-d056c9ad

Scope: `fa6674c..3e8bdb5` (8 files, +733/-32) — hardening of the run-upload path.
Mode: autofix. Plan: docs/plans/2026-08-22-001-feat-storage-backed-model-runs-plan.md (explicit).
Reviewers: 12. All returned.

## Applied in this run

| # | Finding | Reviewers |
| --- | --- | --- |
| 1 | uploadStatus's retry contract never reached the client; handle() throws before the body is read | correctness, reliability, api-contract, frontend-races, agent-native (5) |
| 2 | uploadRun's temp archive leaked on every launch failure, IngestBusy included | correctness |
| 3 | Check-then-append on the ingest bound was not atomic; a handle could be dropped | correctness, adversarial, reliability (3) |
| 4 | Poll loop guarded after the sleep but not after the fetch | frontend-races |
| 5 | Failure cleanup re-listed the prefix, so it could sweep a concurrent upload's objects | adversarial |
| 6 | delete_objects errors discarded under Quiet=True | reliability, kieran-python (2) |
| 7 | Concurrency defaults of 16 exceeded botocore's pool of 10 | performance |
| 8 | No test for _with_fresh_credentials, _is_missing, troute_readable_here, batched delete | testing, kieran-python (2) |
| 9 | No JS test for the poll ceiling or the disconnect guard | testing, project-standards, frontend-races (3) |
| 10 | Storage fake did not model listdir's contract, so the recursive branch never ran | testing |
| 11 | Every NGIAB_* variable undocumented | maintainability, project-standards, agent-native, api-contract (4) |
| 12 | LISTING_CONCURRENCY orphaned the comment above LISTING_TTL_ENV | maintainability |
| 13 | reset() docstring said "tests only" after production began calling it | correctness |
| 14 | Weak assertion: cleanup asserted truthy, not that the right key went | testing |

S3 same-name collision (adversarial, learnings): narrowed, not closed. A manifest check
immediately before the manifest write reduces the window from the whole upload to one PUT.
The conditional PUT that would close it is the plan's own unresolved Release-2 gate.

## Residual — not applied, needs a decision

- Heartbeat during a long conversion. A conversion exceeding NGIAB_JOB_STALE_SECONDS is
  reported failed while still running, and may then publish. Needs convert_outputs to emit
  progress. (correctness P1, reliability P2)
- Deletion off the request path. Batched, still ~36 sequential calls for a 36,000-object run,
  inside the request. (performance P1)
- Job state lives in controllers.py, not ingest.py. (maintainability P2)
- Tunables read at import; the module's other settings are read per call. (maintainability P2)
- Orphaned <root>/_uploads/ingest-* directories after a SIGKILL. (adversarial P2)
- manifest._catchments_cached / _crosswalk_cached still swallow into a cached {}. Predates
  this commit; more conspicuous now that the sibling in run_store was fixed. (learnings)

## Verification

348 Python tests, 163 JS, style checks clean. Against minio: upload publishes, serves, and
deletes; no temp archive left behind.
