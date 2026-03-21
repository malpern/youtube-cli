# ADR 0001: Dedicated Automation Browser Profile

- Status: Accepted
- Date: 2026-03-21

## Context

The migration tool needs to automate a signed-in YouTube session over long runs while preserving safety and debuggability.

Using a normal daily-use browser profile creates several risks:

- unrelated tabs and extensions interfere with automation
- the wrong signed-in account may be used
- repeated debugging runs can mutate the user's normal browser state
- profile locking behavior becomes harder to reason about

## Decision

Use a dedicated browser profile for this project.

The validated local path is:

`/Users/malpern/local-code/youtube-watchlist/.local/chrome-youtube-profile`

This profile is used only for:

- manual Google/YouTube sign-in
- attached browser automation runs for this migration tool

## Consequences

Positive:

- browser state is isolated from normal user activity
- automation runs are more repeatable
- debugging browser/session issues is simpler
- account targeting is easier to reason about

Negative:

- the user must sign in once on a separate browser profile
- profile lifecycle has to be documented clearly

Operational implication:

- future commands should default to the dedicated profile path or accept it explicitly
- migration docs should tell the operator not to use a normal personal/work browser profile
