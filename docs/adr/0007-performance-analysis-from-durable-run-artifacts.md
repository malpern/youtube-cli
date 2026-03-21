# 0007 Performance Analysis From Durable Run Artifacts

Status: accepted

## Context

This migration may run for hours. We need to understand throughput and variability from real runs, and we need those numbers to be reproducible after the fact.

Ad hoc stopwatch measurements are not enough because:

- they are easy to forget during long iterative runs
- they do not separate startup latency from per-item latency
- they do not distinguish `saved` items from `already-saved` items
- they are not durable artifacts future agents can inspect

The tool already writes durable per-run artifacts:

- `events.jsonl`
- `copy-operations.jsonl`
- `checkpoint.json`

## Decision

Performance analysis will be derived from durable run artifacts, not from external timing notes.

We add a `copy-performance` command that analyzes one or more completed copy runs and produces a structured report with:

- total run duration
- startup latency
- completion overhead
- overall items/second
- per-item latency statistics
- latency grouped by copy result, especially `saved` versus `already-saved`
- cross-run aggregate statistics for variability

The report is written as JSON into its own run directory so it becomes part of the durable audit trail.

## Consequences

Positive:

- performance measurements are reproducible
- variability can be compared across runs and run types
- future agents can reason about throughput without replaying old terminal output
- scale-up decisions can be based on measured latency instead of intuition

Negative:

- analysis quality depends on the fidelity of the underlying event and operation logs
- the current report focuses on copy performance and does not yet cover inventory, verify, repair, or future deletion phases
