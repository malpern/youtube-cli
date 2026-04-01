# Operator Experience

This document tracks ways to reduce visual noise on macOS without making the browser automation less reliable.

## Principles

- prefer isolation over UI tricks that fight the browser or the window manager
- keep release checks headless whenever human observation is not required
- keep CDP attachment as the default authenticated development mode
- avoid behavior that hides failures or makes headed debugging harder

## Todo List

- [x] Keep the live DOM gate out of normal dev builds and PR CI. `npm run build` stays fast; `npm run build:release` and the release workflow run the live smoke suite.
- [x] Reuse explicit automation config instead of mixing with a daily-use browser profile. The project already recommends a dedicated profile and CDP session.
- [x] Add configurable window size, position, and viewport controls for Playwright-launched sessions so headed local runs can stay parked in a predictable footprint.
- [x] Surface browser windowing behavior in `doctor` so operators can see when layout controls apply and when CDP mode ignores them.
- [x] Document a low-disruption macOS workflow for headed local work and a headless workflow for release checks.
- [x] Add an optional helper script that launches a dedicated Chrome or Chrome Canary window with the project profile, remote debugging port, and recommended window bounds.
- [x] Evaluate whether a separate automation-only browser app bundle is worth supporting for local smoke runs. Current conclusion: no separate browser app bundle is needed. The existing macOS app and CLI helper should launch the same dedicated automation browser profile and window shape instead.
- [x] Move the `playlists` inspection flow onto a short-lived dedicated page so it does not stomp the main automation page during operator use.

## Recommended macOS Modes

### Day-to-day development

Use `npm run build` for the normal fast path. It does not open a browser.

### Local headed diagnostics and smoke tests

Use a dedicated Chrome or Chrome Canary profile, put that browser on its own macOS Space, and attach over CDP. This keeps the auth model reliable and isolates the visual noise from the user’s normal desktop.

You can open that browser with:

```bash
npm run browser:open
```

CDP mode controls an already-running browser window, so native window size and position overrides from the CLI are intentionally ignored. Manage placement at launch time or with a dedicated Space.

The `playlists` command now uses a short-lived dedicated inspection page and closes it when finished, so it no longer reuses and visibly repurposes the main automation page.

The existing macOS app now launches the same dedicated browser shape as the CLI helper, including the configured CDP port and window bounds. That makes a separate automation-only browser app bundle unnecessary for now.

### Playwright-launched local sessions

If you intentionally use `--profile-dir` or `--storage-state` instead of CDP, you can keep the window footprint predictable with:

```bash
--browser-window-width 1280 \
--browser-window-height 900 \
--browser-window-position-x 1600 \
--browser-window-position-y 40 \
--browser-viewport-width 1280 \
--browser-viewport-height 900
```

These settings apply only to Playwright-launched sessions. They are ignored for CDP-attached runs.

### Release validation

Use the release workflow or `npm run build:release` in headless mode with a stored authenticated session. That removes visible browser churn entirely while preserving the same DOM checks.

The intended refresh path for that headless session is now:

1. keep one trusted headed browser session open over CDP for local auth and recovery
2. export storage state from that live session with `export-storage-state`
3. use the exported storage state for headless release validation
