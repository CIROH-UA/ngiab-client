# ce:review run — 20260823-194207-bb95d536

Scope: `f692229..b318ee9` — the heartbeat (ingest.py + tests/test_heartbeat.py).
Reviewers: 5 (correctness, adversarial, reliability, testing, kieran-python). All returned.
Team scoped to the diff: 3 files, one concern, but it introduces a thread.

## Applied

| Finding | Reviewers |
| --- | --- |
| A late beat could resurrect RUNNING over a terminal DONE/FAILED; join() has a timeout and does not report whether it joined | adversarial (P0), reliability (P1), correctness (P2) |
| beat()'s loop body unguarded — a raising snapshot silently kills the thread and reopens the bug | testing, kieran-python |
| heartbeat_seconds docstring claimed 3 beats of margin; at the default it is 30, and the 1s floor could equal the whole window | reliability, adversarial, testing |
| `hasattr(backend, "path")` filters nothing — Storage defines path() for every backend | kieran-python |
| Beat writes omitted `run`, harmless only because the client reads it solely when terminal | correctness |
| STALE_AFTER_SECONDS' comment justified the window by the silence the heartbeat removes | kieran-python |
| `at` mutated and read as two keys across a thread boundary | kieran-python |
| `_run` too generic beside _publish_directory / _upload_directory | kieran-python |
| Two tests could not fail: the absence check ran after each write returned, and the stop-ordering check held whether or not the join existed | testing |
| Untested: interval clamping, _replace's object-storage branch, a raising snapshot, a failing write, a stage raising under a live beat | testing, kieran-python, adversarial |

The P0 is closed by `write_status(only_if_running=True)`: the beat reads the stored state and
declines to overwrite a terminal one. Ordering is no longer load-bearing — the join only makes
the case rare.

## Residual — reported, not applied

- A run of failed beats still makes a live job look dead. write_status swallows and the beat
  now logs, but nothing counts or escalates. (reliability P2, adversarial P1)
- A SIGKILL between mkstemp and os.replace leaves a .tmp nobody sweeps. Narrow, and not
  fixable from inside the killed process. (adversarial P3, kieran-python)
- Between a SIGKILL and the window elapsing the client still sees RUNNING. Unchanged, and
  inherent to having no supervisor.
- No dedup on job_id: a double-submit starts two subprocesses against one status object.
  Predates this commit. (adversarial)

## Verification

380 Python, 163 JS, style clean. In the container with the window at 3s and uploads
serialised: publishing held 5s, stayed RUNNING, completed, and `run` was present on every
non-terminal poll.
