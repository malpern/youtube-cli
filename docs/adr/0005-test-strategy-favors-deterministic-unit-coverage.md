# 0005 Test Strategy Favors Deterministic Unit Coverage

- Status: accepted

## Context

The project has been developed primarily through live browser iteration against the real YouTube UI:

- inspect the UI
- run a bounded command
- inspect logs and artifacts
- patch selectors or flow logic

That approach is appropriate for unstable browser behavior, but it leaves a gap in deterministic confidence for the parts of the system that do not depend on the live UI.

Those deterministic parts are increasingly important:

- source snapshot resolution
- inventory fingerprint generation
- ordered comparison logic
- drift detection semantics
- resume and checkpoint interpretation
- future deletion gating

Relying only on live runs for those rules is too weak, especially because the project has destructive intent later.

## Decision

The project will keep live browser runs as the primary integration signal for UI behavior, but deterministic business logic must be covered by unit tests and reinforced with explicit runtime assertions.

The minimum unit-test target areas are:

- source snapshot loading and fallback resolution
- inventory fingerprint stability
- ordered comparison and drift mismatch detection
- subset versus full-run verification semantics
- checkpoint parsing and resume eligibility
- unavailable/private/deleted item policy once finalized

Runtime assertions should be added where incorrect state transitions would be dangerous or hard to debug, especially around:

- missing source snapshot inputs
- invalid verification preconditions
- ambiguous deletion eligibility
- mismatch between expected and actual comparison modes

## Consequences

- the repo needs a real unit-test harness
- browser-driven validation remains necessary, but no longer carries the full burden of correctness
- safety-critical logic becomes easier to evolve without re-proving everything in the live UI

Current limitation:

- this ADR records the intended strategy, but the repository does not yet have meaningful unit coverage implemented
