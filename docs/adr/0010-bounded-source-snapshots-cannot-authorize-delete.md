# ADR 0010: Bounded Source Snapshots Cannot Authorize Delete

## Status

Accepted

## Context

The inventory command supports bounded captures via `--max-items` for safe development and debugging. Before this ADR, the snapshot artifact did not explicitly record that it was bounded, which left a gap between “useful for testing” and “safe to use as the basis for destructive authorization.”

## Decision

Every source snapshot now records:

- `requestedMaxItems`
- `bounded`

Production delete authorization fails closed when `bounded === true`, even if the later verification run itself does not pass `--max-items`.

## Consequences

Positive:

- partial or debugging snapshots cannot accidentally authorize destructive deletion
- verification artifacts can explain why a seemingly full verify is still not production-authorizing

Negative:

- tiny isolated test runs can no longer be mistaken for delete-authorizing rehearsals
