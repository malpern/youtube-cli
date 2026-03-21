# ADR 0002: CDP Attachment For Authenticated Sessions

- Status: Accepted
- Date: 2026-03-21

## Context

We tested several authentication and session-control flows:

1. Playwright-managed browser login
2. Playwright launching a persistent browser profile after manual login
3. Plain Chrome manual login with the CLI attaching to the running browser over CDP

Observed issues:

- Google rejected sign-in attempts in a Playwright-managed browser with a "browser or app may not be secure" error.
- Launching a second Playwright-owned browser process against an already-open profile failed with Chromium `ProcessSingleton` locks.
- Even when profile metadata suggested a signed-in account existed, a relaunched Playwright-owned browser did not consistently surface the expected YouTube signed-in state.

## Decision

For authenticated development and migration runs, prefer CDP attachment to a manually opened plain Chrome instance.

The validated workflow is:

1. Open plain `Google Chrome` with:
   - dedicated profile directory
   - `--remote-debugging-port=9222`
2. Sign in to YouTube manually if needed.
3. Keep that window open.
4. Run the CLI with:

```bash
--browser-cdp-url http://127.0.0.1:9222
```

## Consequences

Positive:

- avoids Google's Playwright-login rejection
- avoids launching a second process against the same profile
- reuses the exact browser state the user can see
- makes debugging easier because the human and automation share one browser session

Negative:

- the browser must remain open during CLI runs
- commands that attach to the same browser should not be run in parallel without coordination
- startup requires a manual operator step

Implementation implication:

- CLI commands must support `--browser-cdp-url`
- future phases should treat CDP attachment as the default authenticated mode
- docs must explicitly describe the user-assistance required for login
