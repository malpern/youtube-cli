# 0004 Source Snapshot Is The Run Boundary

- Status: accepted

## Context

Watch Later can change while a migration is running:

- the user can add or remove items manually
- video availability can change mid-run
- a long-running copy pass should not assume the live playlist is stable

If copy logic rereads Watch Later during the run, source indices can drift away from the original migration intent. That becomes especially dangerous once deletion is introduced, because verification could be performed against one source state while removal happens against another.

## Decision

Each migration run treats the initial Watch Later inventory as a frozen source snapshot.

The inventory command writes `inventory.json` with:

- ordered items
- capture metadata
- a deterministic fingerprint

Later phases consume that snapshot instead of rereading Watch Later as their source plan:

- `copy` reads the saved snapshot and copies those rows in order
- `verify` compares the target playlist against the same snapshot
- `verify` also performs a live Watch Later drift check against the snapshot

If a later destructive phase is implemented, it must be gated on a drift check that still matches the frozen source snapshot.

## Consequences

- copy and verification are deterministic relative to a known source snapshot
- source drift is explicit and inspectable instead of implicit
- long runs are safer because the live playlist is no longer the work queue

Current limitation:

- bounded subset verification only checks the selected prefix; a final full migration must run verification without a subset limit before deletion is ever allowed
