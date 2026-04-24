---
title: "feat: Derive teehr_configuration_name client-side (no ngiab-teehr manifest dependency)"
type: feat
status: active
date: 2026-04-24
origin: docs/brainstorms/2026-04-20-teehr-warehouse-compatibility-requirements.md
---

# feat: Derive `teehr_configuration_name` client-side (no ngiab-teehr manifest dependency)

## Overview

The TEEHR warehouse feature currently relies on a cross-repo manifest contract: `ngiab-teehr`'s `scripts/teehr_ngen.py` writes `teehr_run_manifest.json`, and `viewOnTethys.sh` reads it during `add_model_run` to persist `teehr_configuration_name` into `ngiab_visualizer.json`. The producer-side changes cannot land in `ngiab-teehr` right now, so this plan pivots: keep the manifest reader as the authoritative path when a manifest is present, and add a bash-side derivation path that computes the same `teehr_configuration_name` value from the run folder basename when the manifest is absent.

The derivation rule is already specified in the origin document (FR2 fallback) — this plan moves it from "fallback at query time" to "fallback at registration time", so the persisted value in `ngiab_visualizer.json` is correct immediately and the Duplicate-rename flow keeps working unchanged.

## Problem Frame

- The TEEHR warehouse feature depends on `teehr_configuration_name` being stored per run in `ngiab_visualizer.json`.
- `viewOnTethys.sh:589-605` reads this value out of `teehr_run_manifest.json`, which only exists if `ngiab-teehr`'s `scripts/teehr_ngen.py` writes it — and that change is not landing in `ngiab-teehr` at this time.
- The downstream Python reader (origin plan Unit 4, `_resolve_configuration_name`) has a fallback that also derives from basename and validates via `WarehouseReader.configuration_exists(cfg)`, but that fallback only fires when the registry entry has no `teehr_configuration_name` at all, and it re-derives on every query instead of persisting a stable value.
- Without intervention, every registered run goes through the Python fallback forever, and any ngiab-client-side Duplicate-rename breaks basename-derived lookups (because the basename at query time differs from the basename at TEEHR-run time).

Fixing this at registration time in `viewOnTethys.sh` restores the precedence model the origin document already defined — "persisted is authoritative, fallback is rare" — with `ngiab-client` as the sole source of the persisted value.

## Requirements Trace

- **R1. Bash-side derivation at registration time** satisfies origin FR2 primary-path without the manifest. When manifest is absent, `viewOnTethys.sh` derives `teehr_configuration_name` from the run folder basename and persists it into `ngiab_visualizer.json` (see origin: FR2, line 189-192).
- **R2. Manifest still wins when present** preserves the future-proofing contract from origin FR7 — if `ngiab-teehr` ever does land the producer change, the existing reader code path continues to work with no client update (see origin: FR7, line 171-185).
- **R3. Duplicate-rename invariance** — the persisted value is written once at first registration and is carried through the Duplicate flow unchanged (origin risk line 271 — "Run id vs teehr configuration name drift").
- **R4. Sanitization rule parity with TEEHR's producer** — the bash implementation must produce byte-identical output to the Python rule `"ngen_" + re.sub(r"[^a-zA-Z0-9_]", "_", basename).lower()` for the ASCII basenames actually produced by ngen runs (origin risk line 275 — "Sanitization rule drift").

## Scope Boundaries

- **In scope:** Modify `viewOnTethys.sh`'s `add_model_run` function only.
- **In scope:** Update `docs/plans/2026-04-20-001-feat-teehr-warehouse-compatibility-plan.md` to mark Unit 1 (ngiab-teehr manifest emission) as deferred and record the pivot.
- **Non-goal:** Any change to `ngiab-teehr` (the whole point of this plan).
- **Non-goal:** Any change to the Python reader's `_resolve_configuration_name` fallback in origin plan Unit 4. It remains as a second line of defense for runs registered before this change ships.
- **Non-goal:** Retroactive back-fill of `teehr_configuration_name` for runs already in `ngiab_visualizer.json` without the field. (Noted under Open Questions — simple to add later if we want it, but not required for correctness.)

### Deferred to Separate Tasks

- Producer-side manifest emission in `ngiab-teehr/scripts/teehr_ngen.py`: deferred indefinitely. If upstream adopts it later, the existing manifest reader code picks it up with no change required on this side.

## Context & Research

### Relevant Code and Patterns

- `viewOnTethys.sh:583-680` — the `add_model_run` function. The existing flow: (1) gather metadata, (2) read manifest into `teehr_config_name` (lines 589-605), (3) pick jq implementation, (4) drop prior record on overwrite, (5) append new record with `teehr_configuration_name` included only when `$teehr_config_name` is non-empty (jq `if $teehr_cfg == "" then {} else {...} end`).
- The insertion point is **between step 2 and step 3** — if `$teehr_config_name` is still empty after the manifest-read attempt, derive it from `$base_name`.
- `$base_name` is already computed on line 585 (`base_name=$(basename "$input_path")`), so no additional variables are needed.
- The existing conditional field-injection pattern in the jq step stays unchanged — the derived value flows through the same `--arg teehr_cfg` path.

### Institutional Learnings

- `docs/solutions/integration-issues/teehr-api-timeseries-type-rename-2026-04-21.md` — TEEHR API naming evolves between releases. This reinforces R4: the sanitization rule is a live contract, not a frozen spec. Keep it mechanical (pure string transform) rather than invoking any TEEHR library, so rule changes are caught by test fixtures rather than at runtime.

### External References

- None needed. This is a pure string-transform change against a rule specified in the origin requirements document.

## Key Technical Decisions

- **Derive at registration time, not at query time.** The alternative — doing nothing in `viewOnTethys.sh` and leaning entirely on the Python reader's query-time fallback — works for the simple case but loses Duplicate-rename correctness and re-derives on every read. Registering the derived value freezes the mapping at the moment the run folder's basename is known.
- **Keep the manifest reader; derive only when it produces nothing.** Rationale: zero loss of future capability, minimal churn against the code that already landed in commit `8ab7728`. Matches the origin's "primary + fallback" structure with the paths' relative frequencies flipped.
- **Use `LC_ALL=C` around the `sed`/`tr` pipeline.** Rationale: defend against locales where `[a-zA-Z]` expands beyond ASCII or where `tr '[:upper:]'` misbehaves. The Python producer's `re.sub(r"[^a-zA-Z0-9_]", "_", ...)` is ASCII-only; the bash equivalent must match byte-for-byte (R4).
- **Log which source supplied the value.** Keep the existing "Registered TEEHR configuration: …" line for the manifest path; add a distinct line for the derivation path so operators can tell which code path fired. Important because the derivation path is more fragile (silent rule drift risk).

## Open Questions

### Resolved During Planning

- **Should the derivation replace or supplement the manifest read?** Supplement. The manifest path already exists, already works, and already represents the authoritative upstream contract. Removing it would make re-adoption of the producer-side change a code change on this side — unnecessary churn.
- **Should we derive from `$base_name` (pre-`final_path`) or from `$final_path` (post-registration path)?** From `$base_name` — it is the unrenamed, user-supplied folder name, which is exactly what the TEEHR producer would have sanitized. `$final_path` is always `/var/lib/tethys_persist/ngiab_visualizer/$base_name`, so it is equivalent via basename extraction, but deriving from `$base_name` directly is cheaper and clearer.
- **Do we need to validate the derived name against the warehouse before persisting it?** No. The origin plan's reader-side fallback (Unit 4) already calls `configuration_exists(cfg)` before returning a match; that guard remains in place for runs that truly have no warehouse data. Pushing the check into `viewOnTethys.sh` would require the bash script to open the DuckDB warehouse (substantial new dependency) and would reject the legitimate case of "register-now, run-TEEHR-later."

### Deferred to Implementation

- **Log wording for the derivation path** — the exact string and color convention should match the existing `${INFO_MARK} ${BCyan}` style already used in the manifest-read success path. Pick during implementation.
- **Back-fill of pre-existing registry entries** — whether to retroactively add `teehr_configuration_name` to already-registered runs during an `add_model_run` touch. Not required; skipping for now. If users complain that old runs still miss the field, revisit as a small `migrate` subcommand.

## Implementation Units

- [x] **Unit 1: Add bash-side derivation fallback in `viewOnTethys.sh`'s `add_model_run`**

**Goal:** When `teehr_run_manifest.json` is absent (or present but fails to supply a `teehr_configuration_name`), derive the value from the run folder basename using the exact rule `"ngen_" + sanitize(basename)` where `sanitize = replace non-alphanumeric-or-underscore with "_", then lowercase`. Persist into `ngiab_visualizer.json` through the existing jq append block.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None — single-file change to a live script.

**Files:**
- Modify: `viewOnTethys.sh` (function `add_model_run`, insertion between the existing manifest-read block and the jq-exec selection block)

**Approach:**
- After the existing manifest-read block (`viewOnTethys.sh:589-605`), check whether `$teehr_config_name` is still empty.
- When empty, compute: `sanitized_basename = "$base_name"` piped through `LC_ALL=C sed -E 's/[^a-zA-Z0-9_]/_/g'` then `LC_ALL=C tr '[:upper:]' '[:lower:]'`.
- Prefix `ngen_` and assign to `$teehr_config_name`.
- Emit a distinct `${INFO_MARK}` log line clarifying the value was derived from the run folder name rather than read from a manifest, so operators can tell the paths apart.
- No changes to the jq blocks — the existing `--arg teehr_cfg` + conditional-injection pattern handles the derived value identically.

**Technical design:** *(directional — not implementation code)*

Pseudo-shell showing the insertion shape only:

    # ── existing manifest-read block stays here ────────────────
    # … reads $teehr_config_name from $manifest if present …

    # ── NEW: bash-side derivation when manifest did not supply ──
    if [ -z "$teehr_config_name" ]; then
        teehr_config_name="ngen_$(printf '%s' "$base_name" \
            | LC_ALL=C sed -E 's/[^a-zA-Z0-9_]/_/g' \
            | LC_ALL=C tr '[:upper:]' '[:lower:]')"
        # log that derivation fired
    fi

    # ── existing jq-exec block continues below ─────────────────

**Patterns to follow:**
- `viewOnTethys.sh` function style: short comment banner lines (`# ── N. Title ────`), snake_case locals, `${INFO_MARK}/${WARNING_MARK}/${CHECK_MARK}` + color-variable logging.
- Conditional jq field injection pattern already in use at `viewOnTethys.sh:664-668`.

**Test scenarios:**
- **Happy path — no manifest, typical basename:** Call `add_model_run` on an input folder named `AWI_16_2863657_007` with no `teehr_run_manifest.json` → `ngiab_visualizer.json` entry gains `teehr_configuration_name: "ngen_awi_16_2863657_007"`.
- **Happy path — manifest present, value non-empty:** Call `add_model_run` on a folder with a valid manifest containing `"teehr_configuration_name": "ngen_custom_name"` → the manifest value wins; derivation does not fire and does not log.
- **Edge case — basename with hyphens, periods, spaces:** Input folder `foo-bar.001 run` → derived value is `ngen_foo_bar_001_run` (each `-`, `.`, space replaced with `_`, then lowercased).
- **Edge case — basename with uppercase and digits:** Input `AWI_16_2863657_007` → `ngen_awi_16_2863657_007` (digits preserved, letters lowered, underscores preserved).
- **Edge case — basename that is already all-lowercase and underscored:** `awi_16_2863657_007` → `ngen_awi_16_2863657_007` (no-op sanitize; prefix only).
- **Edge case — Duplicate-rename flow:** After an initial `add_model_run` that persists `ngen_awi_16_2863657_007`, the `copy_models_run` Duplicate flow renames the registry entry. Expected: the persisted `teehr_configuration_name` is NOT re-derived from the new name and remains `ngen_awi_16_2863657_007`. (This is a test of the existing copy flow; no change needed, but the scenario must be verified to defend R3.)
- **Error path — manifest present but malformed JSON:** `teehr_run_manifest.json` exists with invalid JSON → existing warning fires from the manifest-read block; `$teehr_config_name` is empty; derivation fires; entry is registered with a derived value, not omitted.
- **Error path — manifest present but missing the field:** Valid JSON, no `teehr_configuration_name` key → existing warning fires; `$teehr_config_name` is empty; derivation fires; entry still populated.
- **Integration — value flows through to Python reader:** After registration, `_resolve_configuration_name` in origin plan Unit 4 finds the persisted value first and returns it without calling `WarehouseReader.configuration_exists`. (This verifies the persisted-value precedence rule from origin line 192 holds under the new source.)

**Verification:**
- After running `viewOnTethys.sh add_model_run /some/path/AWI_16_2863657_007` with no manifest present, `jq '.model_runs[-1].teehr_configuration_name' ngiab_visualizer.json` outputs `"ngen_awi_16_2863657_007"`.
- When a valid manifest is present, the same command outputs the manifest-supplied value, not the basename-derived one.
- Operator logs distinguish the two paths clearly.

- [x] **Unit 2: Update the TEEHR-warehouse-compatibility origin plan**

**Goal:** Reflect the pivot in `docs/plans/2026-04-20-001-feat-teehr-warehouse-compatibility-plan.md` so future readers understand why Unit 1 (manifest emission in `ngiab-teehr`) is not landing in this release and how client-side derivation replaces it.

**Requirements:** N/A — documentation hygiene to keep the origin plan an accurate record.

**Dependencies:** Unit 1 complete and committed.

**Files:**
- Modify: `docs/plans/2026-04-20-001-feat-teehr-warehouse-compatibility-plan.md`

**Approach:**
- In the origin plan's Unit 1 (ngiab-teehr manifest emission), add a banner note: "Deferred. See `docs/plans/2026-04-24-001-feat-teehr-config-name-client-derivation-plan.md` for the client-side replacement."
- In Unit 7 (`viewOnTethys.sh` manifest ingestion), add a note that manifest is now one of two sources, with bash-side derivation as the fallback when absent.
- Do not rewrite the origin plan's history — leave Unit 1's design intact so the manifest flow can be re-adopted later without re-planning.

**Patterns to follow:**
- Inline banner comment style already used elsewhere in the docs/plans/ tree (unchecked checkbox plus a one-line status note).

**Test expectation:** none -- pure documentation update with no behavioral change.

**Verification:**
- A reader of the origin plan can tell, from skimming, that Unit 1 is not in this release and where to find the replacement.

## System-Wide Impact

- **Interaction graph:** `viewOnTethys.sh` → `ngiab_visualizer.json` → Python reader `_resolve_configuration_name` (origin plan Unit 4). The reader's behavior is unchanged; it still prefers the persisted value and falls through to its own derivation if absent. This plan just makes "persisted value absent" a much rarer case.
- **Error propagation:** Manifest read errors already degrade gracefully (warning + empty value). Derivation of an empty basename is not possible (`basename` returns a non-empty string for any valid path). No new error modes introduced.
- **State lifecycle risks:** The persisted value is frozen at first registration. If the bash sanitization rule ever diverges from TEEHR's Python rule, entries registered under the old rule will remain in `ngiab_visualizer.json` indefinitely — but the warehouse content is also frozen at the old name, so the entry still resolves correctly. Rule drift affects only *new* registrations made after a rule change.
- **API surface parity:** None — this is a private registry file, not an external API.
- **Integration coverage:** The "derived value flows through to Python reader" test scenario in Unit 1 is the one case unit tests alone cannot cover. It should be exercised as part of the existing integration suite (if one exists) or a one-off manual check during implementation.
- **Unchanged invariants:**
  - The shape of `ngiab_visualizer.json` entries is unchanged. `teehr_configuration_name` is still conditionally present.
  - The "Duplicate" rename flow in `copy_models_run` is unchanged and continues to preserve the persisted field verbatim.
  - The Python reader's `_resolve_configuration_name` is unchanged. Precedence rule from origin line 192 ("persisted is authoritative") still holds.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Bash sanitization rule drifts from TEEHR's Python rule (e.g., TEEHR starts stripping accents, applies Unicode normalization, or changes the regex class) | The risk is explicit in origin line 275. Mitigation: keep the implementation mechanical (no dependencies), document the rule in a comment above the sed/tr pipeline that references `scripts/teehr_ngen.py` line 66 (the canonical producer source), and add a test fixture that encodes the current rule so a future drift fails loudly. |
| A non-ASCII basename produces different bytes under a non-C locale | Wrap sed and tr with `LC_ALL=C`. Test with at least one basename containing a non-ASCII character to confirm the behavior matches the ASCII-only producer. |
| A prior registered run has no `teehr_configuration_name` and the user expects a re-register to add it | Documented behavior (Open Questions → Deferred): registering the same base_name again with `overwrite_used` triggers a full delete + re-append, which will pick up the new derivation. Users on the Duplicate-then-open flow may still see the old entry lacking the field — this plan intentionally does not migrate in-place. |

## Documentation / Operational Notes

- Add a brief comment block above the new derivation stanza in `viewOnTethys.sh` pointing at the origin requirements document (FR2) and at `ngiab-teehr/scripts/teehr_ngen.py` line 66 as the canonical producer source for the sanitization rule.
- No user-facing docs change needed — the feature works the same from the visualizer's perspective.

## Sources & References

- **Origin document (requirements):** `docs/brainstorms/2026-04-20-teehr-warehouse-compatibility-requirements.md` — FR2 (line 189), FR7 (line 171), precedence rule (line 192), risks (lines 271, 275).
- **Origin plan:** `docs/plans/2026-04-20-001-feat-teehr-warehouse-compatibility-plan.md` — Unit 1 (manifest emission, deferred), Unit 4 (`_resolve_configuration_name`), Unit 7 (viewOnTethys.sh manifest ingestion).
- **Relevant code:** `viewOnTethys.sh:583-680` (`add_model_run`), `viewOnTethys.sh:518-531` (Duplicate flow — `copy_models_run`).
- **Canonical sanitization rule source:** `ngiab-teehr/scripts/teehr_ngen.py` (the `ngen_configuration_name` computation) — do not import or call, only mirror the byte-for-byte string transform.
- **Related solution doc:** `docs/solutions/integration-issues/teehr-api-timeseries-type-rename-2026-04-21.md` — illustrates prior precedent for TEEHR-side API rename causing client-side churn.
