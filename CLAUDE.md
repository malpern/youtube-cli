# CLAUDE.md

This repository is a safety-first CLI for migrating a YouTube Watch Later playlist into `Old Watch`.

## Review priorities

When reviewing code, prioritize:

1. Correctness bugs and behavioral regressions
2. Safety around destructive actions, especially delete gating
3. Resume/checkpoint integrity
4. Verification accuracy and drift detection
5. Auth/session loss handling
6. Missing or weak tests for risky changes

## Important constraints

- Never treat deletion as safe unless verification explicitly authorizes it.
- Snapshot artifacts are the source of truth for a run.
- Auth loss should pause the run, not be treated as an ordinary retryable failure.
- Prefer concrete findings over broad style advice.
