# Authentication Workflow

This project cannot rely on a fully Playwright-managed Google sign-in flow.

## What We Learned

- Launching a browser directly under Playwright control can trigger Google's "This browser or app may not be secure" sign-in rejection.
- Reusing a browser profile by launching a second Playwright-owned browser process against the same profile can fail with Chromium `ProcessSingleton` profile locks.
- A plain Chrome window can sign in normally and persist the session to disk.
- The most reliable automation mode is:
  - user signs in through a normal Chrome window on a dedicated profile
  - Chrome stays running with a remote debugging port
  - the CLI attaches to that running browser over CDP

## Required User Assistance

The user must help only with the Google authentication step.

The expected operator workflow is:

1. Start a plain `Google Chrome` window on the dedicated project profile.
2. Sign in to Google and confirm YouTube is fully signed in.
3. Leave that browser window open.
4. Let the CLI attach to the running browser over CDP.

The user should not need to assist with the migration logic after the browser is signed in and attached.

## Dedicated Profile

Use a dedicated browser profile for this project only.

Current validated profile path:

`/Users/malpern/local-code/youtube-watchlist/.local/chrome-youtube-profile`

Do not automate against a normal daily-use Chrome profile.

Reasons:

- fewer unrelated tabs and extensions
- less risk of changing the wrong session
- easier repeatability across runs
- lower risk of profile corruption while debugging automation

## Validated Browser Mode

Use plain `Google Chrome` with a remote debugging port:

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="/Users/malpern/local-code/youtube-watchlist/.local/chrome-youtube-profile" \
  https://www.youtube.com
```

After the browser is open and signed in, attach the CLI with:

```bash
npx tsx src/cli.ts doctor --browser-cdp-url http://127.0.0.1:9222
```

## What Not To Do

Avoid these flows unless a future implementation proves otherwise:

- signing in through a Playwright-launched browser window
- running `doctor`, `probe-selectors`, or `inventory` in parallel against the same browser profile
- launching a second browser process against an already-open dedicated profile
- using a personal daily-use browser profile as the automation profile

## How To Tell Auth Is Working

Current successful indicators:

- `curl http://127.0.0.1:9222/json/version` returns browser metadata
- `doctor` reports:
  - `PASS browser.config`
  - `PASS youtube.auth: Signed in to YouTube`
- `probe-selectors` opens `https://www.youtube.com/playlist?list=WL`
- `probe-selectors` reports non-zero `playlistVideoRenderer` counts

## Failure Modes Seen So Far

### Google sign-in rejection

Symptom:

- Google login page shows `Couldn't sign you in`
- message says the browser or app may not be secure

Meaning:

- the browser was launched under Playwright control for the login step

Action:

- stop using Playwright for login
- sign in through plain Chrome on the dedicated profile instead

### Chromium profile lock

Symptom:

- Playwright fails with `Failed to create a ProcessSingleton`

Meaning:

- another Chrome/Chromium process already owns the profile directory

Action:

- do not launch another browser process on that profile
- either close the owning process or attach over CDP to the already-running browser

### Signed in manually, but not under automation

Symptom:

- Chrome profile metadata shows a signed-in primary account
- but a Playwright-launched browser on that same profile appears signed out

Meaning:

- profile reuse under a second launched browser is less reliable than CDP attachment in this environment

Action:

- prefer attaching to the already-running signed-in Chrome instance over CDP

## Current Recommended Development Workflow

1. Start Chrome manually on the dedicated profile with `--remote-debugging-port=9222`.
2. Sign in once if needed.
3. Keep that Chrome window open for the whole development session.
4. Run all CLI commands with `--browser-cdp-url http://127.0.0.1:9222`.
5. Do not run profile-owning commands in parallel.

## Post-Cooldown Resume

If Google pauses the session again, use this order:

1. Stop retrying immediately and wait out the cooldown. Plan for `48 hours` minimum; if Google still blocks sign-in, use `7 days` from the last failed attempt as the safer bound.
2. Open plain `Google Chrome` on the same dedicated profile and the same network, then sign in manually.
3. Keep that browser open and confirm `doctor` reports signed-in YouTube state over CDP.
4. Run a tiny validation copy against the paused source snapshot, such as `--max-items 5`, before restarting the full job.
5. Resume the full copy from the existing checkpoint and source snapshot with `--resume` on the paused copy run id.

Example commands:

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="/Users/malpern/local-code/youtube-watchlist/.local/chrome-youtube-profile" \
  https://www.youtube.com

PATH="/opt/homebrew/opt/node/bin:$PATH" npx tsx src/cli.ts doctor \
  --browser-cdp-url http://127.0.0.1:9222

PATH="/opt/homebrew/opt/node/bin:$PATH" npx tsx src/cli.ts copy \
  --browser-cdp-url http://127.0.0.1:9222 \
  --source-run-id 2026-03-21T18-24-08-552Z-vvihmn \
  --start-index 70 \
  --max-items 5

PATH="/opt/homebrew/opt/node/bin:$PATH" npx tsx src/cli.ts \
  --run-id 2026-03-21T18-40-18-882Z-867mr0 \
  copy \
  --browser-cdp-url http://127.0.0.1:9222 \
  --source-run-id 2026-03-21T18-24-08-552Z-vvihmn \
  --resume
```
