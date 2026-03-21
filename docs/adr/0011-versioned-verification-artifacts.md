# ADR 0011: Versioned Verification Artifacts Fail Closed

## Status

Accepted

## Context

Source snapshots are now versioned and legacy snapshots fail closed for production authorization. Verification artifacts still had a weaker contract: older `verification.json` files could be read by shape and treated as valid inputs for repair, delete gating, workflow summaries, and future orchestration.

That was too permissive. The tool has no external users yet, so preserving compatibility with older artifact shapes is less important than making destructive gating explicit and unambiguous.

## Decision

Verification artifacts now require:

- `reportVersion: 1`
- `reportComplete: true`
- `productionDeleteAuthorization`

The CLI fails closed when those fields are missing or unsupported. Older verification artifacts must be regenerated with the current `verify` command before they can be used for repair, delete gating, or workflow rollups.

## Consequences

Positive:

- delete and repair operate on an explicit, versioned verification contract
- legacy verification reports cannot silently bypass new safety requirements
- workflow summaries and orchestration can trust a stricter artifact shape

Negative:

- older verification runs are intentionally incompatible and must be rerun
- tests and documentation must be kept aligned with the versioned artifact contract
