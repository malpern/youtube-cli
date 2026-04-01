# 0012 Auth Loss Pauses Runs And Mutations Are Throttled

- Status: accepted
- Date: 2026-03-21

## Context

During a live saved-path benchmark, YouTube redirected the browser from watch pages to Google sign-in URLs and the session was effectively signed out. Continuing to retry mutation work after that point would only increase suspicious activity and blur the difference between an ordinary item failure and a broader account/session problem.

At the same time, the next optimization phase cannot be "go as fast as possible." Faster mutation loops can look more bot-like and may increase risk signals even if they reduce wall-clock time.

## Decision

- Auth loss is treated as a first-class paused state, not a generic mutation failure.
- Mutation phases must detect:
  - redirects to `accounts.google.com`
  - missing signed-in YouTube state
  - signed-in account mismatch
- When auth loss is detected, the CLI must:
  - checkpoint immediately
  - write an `auth.paused` event
  - mark the run state as `paused`
  - stop retrying the current operation
- Mutation retries must treat auth loss as non-retryable.
- Mutation phases must apply conservative pacing:
  - per-item jitter
  - periodic cooldown pauses

## Consequences

- A paused run is easier to resume safely and easier to distinguish from an item-level failure.
- Large runs will be intentionally slower than the browser's theoretical maximum throughput.
- Future speed work is constrained to removing wasted waiting, not increasing mutation aggression.
- Workflow operators now have a clearer signal for when manual intervention is required before resuming.
