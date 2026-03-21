# ADR 0008: Bounded Retries For Mutation Phases

## Status

Accepted

## Context

The original migration spec requires bounded retries, explicit retry visibility, and a bias toward stopping safely instead of assuming success. The live YouTube UI is materially flaky enough that single-attempt mutation steps are too brittle for copy, repair, and delete.

## Decision

Use a shared bounded retry policy for all mutation phases:

- `copy`
- `repair`
- `delete`

Default policy:

- `maxAttempts = 3`
- `retryInitialDelayMs = 1000`
- `retryMaxDelayMs = 8000`
- exponential backoff with multiplier `2`

Every retryable failure emits an explicit event log entry before the next attempt. Final per-item operation logs also include the total attempt count.

## Consequences

Positive:

- transient UI failures no longer immediately fail the whole item
- retry behavior is visible in durable logs
- retry semantics are consistent across mutation phases

Negative:

- worst-case runtime increases on failing items
- retrying delete requires especially careful evidence checks to avoid false-positive removals

## Notes

Retries remain bounded and fail closed. Exhausting attempts still records a failure and preserves the existing destructive gates.
