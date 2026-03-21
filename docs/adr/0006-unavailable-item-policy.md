# 0006 Unavailable Item Policy

- Status: accepted

## Context

Watch Later can contain rows that are not normal copyable videos:

- private videos
- deleted videos
- generally unavailable videos
- ambiguous rows where the tool cannot recover a stable video URL or id

Those cases must not be treated uniformly.

If every non-copyable row is treated as a hard failure, the migration becomes unnecessarily brittle. If every non-copyable row is silently skipped, the verification model becomes too weak and can hide real extraction problems.

## Decision

The tool distinguishes three source-item policies:

- `copyable`
- `expected-non-copyable`
- `ambiguous-unavailable`

Classification rules:

- `private`, `deleted`, and `unavailable` rows are `expected-non-copyable`
- rows with `unavailableKind = unknown` are `ambiguous-unavailable`
- rows missing a usable `videoUrl` without a known unavailable state are `ambiguous-unavailable`
- rows with a normal available URL are `copyable`

Behavior:

- `copy` skips `expected-non-copyable` items and logs them explicitly
- `copy` treats `ambiguous-unavailable` items as failures that require review
- `verify` compares the target playlist only against the `copyable` subset
- `verify` still compares live Watch Later drift against the full source snapshot
- `verify` emits explicit mismatches for ambiguous source items so verification cannot pass silently when the source is unclear

## Consequences

- private/deleted/unavailable rows do not incorrectly fail target verification
- ambiguous rows remain safety blockers instead of being silently ignored
- copy and verify now share one classification model

Current limitation:

- this policy does not yet cover every future repair strategy or deletion behavior; those later phases must preserve the distinction between expected non-copyable and ambiguous source items
