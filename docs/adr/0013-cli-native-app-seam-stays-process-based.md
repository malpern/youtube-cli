# ADR 0013: CLI Native App Seam Stays Process Based

## Status

Accepted

## Context

The macOS app currently uses the TypeScript CLI as its backend by spawning CLI commands and decoding JSON responses for a small number of app-facing workflows:

- `doctor --json`
- `playlists --json`
- `move --json`

This seam is directionally correct because the app does not link directly against TypeScript internals or duplicate the migration logic locally. At the same time, the current integration is still lightweight and development-oriented:

- the app executes `tsx src/cli.ts` from the repository checkout
- the JSON response shapes are implicit rather than versioned as a formal contract
- some browser-launch behavior is duplicated between the app and the CLI

The question is whether to introduce a more formal backend architecture now, such as RPC, generated schemas, a packaged backend service, or a separate automation-only app bundle.

That would be premature for the current stage of the project. The app has a narrow backend surface area, the repository is still local-development-first, and the highest-value risks are accidental contract drift and duplicate launch behavior rather than transport complexity.

## Decision

Keep the CLI/native app seam process-based.

For the current stage of the project:

- the native app should continue to invoke the CLI as an external process
- the app-facing JSON outputs used by the native app should be treated as a stable contract
- contract hardening should stay minimal:
  - avoid casually reshaping app-consumed JSON fields
  - prefer narrow contract tests over a new transport or schema system
  - keep browser-launch behavior aligned between app and CLI where both need it

Do not introduce the following unless distribution or packaging requirements make them necessary:

- an RPC layer between the app and CLI
- generated cross-language schemas
- a long-running backend service
- a separate automation-only browser app bundle
- a packaged binary backend replacing the development checkout path

If the app later needs to run outside the repository checkout, that is the point to reconsider a packaged backend entrypoint or stricter versioned interface.

## Consequences

Positive:

- the backend seam stays simple and easy to debug
- the app continues to reuse the CLI's real safety logic instead of reimplementing it
- engineering effort stays focused on contract stability and operator experience instead of speculative architecture

Negative:

- the app remains coupled to the local repository layout and Node toolchain for now
- the JSON contract still requires discipline because it is not enforced by a shared schema system
- future distribution outside the repo will require revisiting this decision
