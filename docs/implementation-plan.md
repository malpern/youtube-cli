# Implementation Plan

This plan tracks the remaining work to turn the current diagnostic-first prototype into a safe full migration tool.

Status legend:

- ✅ complete
- 🚧 active / next
- ⏳ pending

## Current state

Implemented and validated on the live authenticated YouTube UI:

- ✅ dedicated signed-in browser workflow via Chrome + CDP
- ✅ Watch Later inventory capture
- ✅ frozen source snapshot with deterministic fingerprint
- ✅ target playlist creation and discovery
- ✅ bounded copy flow from source snapshot to `Old Watch`
- ✅ bounded verification against target playlist
- ✅ bounded live source drift check against the source snapshot
- ✅ durable copy performance analysis from run artifacts

Still missing or incomplete:

- 🚧 meaningful deterministic unit test coverage, now started with snapshot and verification unit tests
- 🚧 formal unavailable/private/deleted item policy, now implemented for copy and bounded verify
- 🚧 duplicate-aware full discrepancy engine, now started with discrepancy summaries in verification artifacts
- 🚧 durable resume planner driven from checkpoint state, now implemented for copy resume
- 🚧 deletion safety model, now codified in verification eligibility but not yet implemented as a phase

## Milestones

### ✅ M1: Snapshot-first foundation

- keep `inventory.json` as the source of truth for a run
- preserve deterministic source fingerprinting
- ensure copy and verify never silently fall back to live Watch Later as a source plan

Status: ✅ complete

### ✅ M2: Bounded live-copy loop

- prove `setup`, `copy`, and `verify` on 3-item and 10-item subsets
- capture structured logs and failure artifacts
- confirm target ordering matches source ordering on bounded runs

Status: ✅ complete

### 🚧 M3: Deterministic correctness harness

- ✅ add a unit-test runner
- ✅ add tests for source snapshot resolution
- ✅ add tests for fingerprint stability
- ✅ add tests for ordered comparison and drift mismatch detection
- ✅ add tests for subset versus full-run verification count rules
- ✅ add tests for checkpoint interpretation and resume eligibility
- 🚧 add explicit assertions around dangerous state transitions

Status: 🚧 active / next

### 🚧 M4: Edge-case policy

- ✅ define how private/deleted/unavailable items are classified
- ✅ decide which unavailable items are expected non-copyable versus verification failures
- ✅ encode that policy in both copy and verify logic
- ✅ test those rules with deterministic fixtures
- ⏳ extend the same policy into repair and future deletion behavior

Status: 🚧 active

### 🚧 M5: Full verification engine

- ✅ move beyond prefix checks to discrepancy summaries
- ✅ detect missing items
- ✅ detect duplicate multiplicity mismatches
- ✅ detect order mismatches across the full snapshot
- ✅ emit a durable discrepancy report suitable for repair planning
- ✅ use the discrepancy report to drive targeted repair on failing runs

Status: 🚧 active

### 🚧 M6: Resume hardening

- ✅ resume from checkpoints without relying on in-memory progress for copy
- ✅ skip already-confirmed copied items safely for copy resume
- ✅ resume repair from checkpoints without replaying already-processed repair candidates
- ⏳ separate retryable, skipped, and terminal failures
- ⏳ allow verification to be rerun independently against an existing snapshot
- ⏳ extend resume planning beyond copy into repair and deletion phases

Status: 🚧 active

### ⏳ M7: Scale testing

- ✅ run snapshot-backed copy + verify on 25 items
- ✅ collect measured copy throughput and latency variability from durable logs
- ✅ then 50 items
- ✅ inspect logs, rate, and failure artifacts after each scale-up
- ⏳ tune waits, retries, and pacing only from observed behavior

Status: 🚧 active

### ⏳ M8: Deletion safety model

- ✅ define deletion preconditions
- ✅ require successful target verification and source drift check
- ⏳ add explicit destructive confirmation gating
- ⏳ implement deletion only after the above conditions are durable and asserted

Status: 🚧 active

## Immediate next steps

1. Add stronger runtime assertions around verification mode and future deletion eligibility.
2. Extend the unavailable-item policy into future deletion gating.
3. Allow verification to be rerun independently against an existing snapshot/run state.
4. Extend resume planning from copy and repair into future deletion.
5. Decide whether to keep scaling further before deletion work, or switch to implementing the deletion phase with the current evidence base.

## After current plan completes

Once the current safety-first implementation plan is complete, add a dedicated optimization pass focused on large-job throughput.

Planned follow-up:

1. Brainstorm safe ways to increase speed for large migrations without weakening verification or deletion gating.
2. Separate optimizations for `saved` work versus `already-saved` idempotent checks.
3. Measure each candidate optimization against the baseline in [Performance Notes](/Users/malpern/local-code/youtube-watchlist/docs/performance.md).
4. Keep any accepted speed changes behind the same durable logging, checkpointing, and audit model.
