# ADR 0009: Explicit Production Delete Authorization

## Status

Accepted

## Context

Verification has been safe, but the artifact shape still required operators and future agents to infer whether a verification run was suitable to authorize destructive deletion. That inference was based on a generic `deletionEligibility` object rather than an explicit authorization record.

## Decision

Every verification report now includes a first-class `productionDeleteAuthorization` object that states:

- whether the verification run is authorized to drive production deletion
- why it is blocked when it is not authorized
- whether the verification mode was `full` or `subset`
- which verification run produced the authorization decision

The delete gate now prefers this explicit authorization record over the older inferred eligibility field.

## Consequences

Positive:

- delete authorization is explicit and auditable
- future agents do not need to reverse-engineer verification semantics from multiple fields
- subset verification is clearly represented as diagnostic-only, not merely “failed eligibility”

Negative:

- verification artifacts are slightly larger
- delete gate must preserve backward-compatible fallback behavior for older reports during development
