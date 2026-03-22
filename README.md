# YouTube Watchlist

Diagnostic-first CLI for migrating YouTube Watch Later into `Old Watch`.

## Current status

The project currently includes the foundation for:

- durable per-run directories under `runs/<run-id>/`
- SQLite-backed run state and events
- append-only `events.jsonl`
- `checkpoint.json`
- `inventory.json` as the frozen source snapshot for a run
- `doctor` command for environment, auth, and account checks
- `probe-selectors` command for live Watch Later selector diagnostics
- `inventory` command for ordered Watch Later capture
- `setup` command for ensuring the target playlist exists
- `copy` command that consumes a saved source snapshot instead of rereading Watch Later
- `verify` command that compares the target playlist and live Watch Later drift against a saved source snapshot
- `copy-performance` command that measures copy throughput and latency from durable run logs

## Quick start

Install dependencies:

```bash
npm install
```

Local build now includes three gates in order: typecheck, the Vitest suite, and a live YouTube DOM smoke suite before TypeScript compilation finishes. If the live YouTube selectors drift, `npm run build` fails.

The repo now assumes Node 25.x. Use the version in [.nvmrc](/Users/malpern/local-code/youtube-cli/.nvmrc) or [.node-version](/Users/malpern/local-code/youtube-cli/.node-version) so native modules like `better-sqlite3` stay ABI-compatible with the CLI and tests.

Recommended authenticated development flow:

1. Open plain Chrome on the dedicated profile with a remote debugging port.
2. Sign in to YouTube manually.
3. Keep that browser open.
4. Run CLI commands against `--browser-cdp-url http://127.0.0.1:9222`.

Environment check:

```bash
npx tsx src/cli.ts doctor --browser-cdp-url http://127.0.0.1:9222
```

Inspect the latest or a specific run without opening raw artifacts:

```bash
npx tsx src/cli.ts status
npx tsx src/cli.ts status --inspect-run-id <run-id>
```

Probe the Watch Later page selectors:

```bash
npx tsx src/cli.ts probe-selectors --browser-cdp-url http://127.0.0.1:9222
```

Capture a bounded inventory:

```bash
npx tsx src/cli.ts inventory --browser-cdp-url http://127.0.0.1:9222 --max-items 150
```

That `inventory.json` becomes the source of truth for later copy and verify commands.

If you capture inventory with `--max-items`, that snapshot is explicitly marked as bounded and can never authorize deletion later.

Ensure the target playlist exists:

```bash
npx tsx src/cli.ts setup --browser-cdp-url http://127.0.0.1:9222 --target-playlist "Old Watch"
```

Copy from a specific source snapshot first:

```bash
npx tsx src/cli.ts copy --browser-cdp-url http://127.0.0.1:9222 --source-run-id <inventory-run-id> --target-playlist "Old Watch" --max-items 10
```

Mutation phases use bounded retries by default:

- `--max-attempts 3`
- `--retry-initial-delay-ms 1000`
- `--retry-max-delay-ms 8000`

Mutation phases now also use conservative pacing by default:

- `--jitter-min-ms 250`
- `--jitter-max-ms 1250`
- `--cooldown-every 50`
- `--cooldown-ms 45000`

Run the non-destructive workflow end-to-end:

```bash
npx tsx src/cli.ts run --browser-cdp-url http://127.0.0.1:9222 --target-playlist "Old Watch" --max-items 10
```

Or reuse an existing snapshot and skip setup:

```bash
npx tsx src/cli.ts run --browser-cdp-url http://127.0.0.1:9222 --skip-setup --source-run-id <inventory-run-id> --target-playlist "Old Watch" --max-items 10
```

You can tune the workflow copy retries the same way:

```bash
npx tsx src/cli.ts run --browser-cdp-url http://127.0.0.1:9222 --max-attempts 3 --retry-initial-delay-ms 1000 --retry-max-delay-ms 8000
```

Resume a copy run from its checkpoint:

```bash
npx tsx src/cli.ts --run-id <copy-run-id> copy --browser-cdp-url http://127.0.0.1:9222 --source-run-id <inventory-run-id> --target-playlist "Old Watch" --resume
```

Verify both the copied ordered prefix and source drift against that same snapshot:

```bash
npx tsx src/cli.ts verify --browser-cdp-url http://127.0.0.1:9222 --source-run-id <inventory-run-id> --target-playlist "Old Watch" --max-items 10
```

Retry only the items called out by a verification report:

```bash
npx tsx src/cli.ts repair --browser-cdp-url http://127.0.0.1:9222 --verification-run-id <verify-run-id> --target-playlist "Old Watch"
```

Resume a repair run from its checkpoint:

```bash
npx tsx src/cli.ts --run-id <repair-run-id> repair --browser-cdp-url http://127.0.0.1:9222 --verification-run-id <verify-run-id> --target-playlist "Old Watch" --resume
```

Analyze completed copy runs for throughput and latency variability:

```bash
npx tsx src/cli.ts copy-performance --copy-run-id <copy-run-id-1> <copy-run-id-2>
```

Plan a real full run from an existing snapshot plus measured copy baselines:

```bash
npx tsx src/cli.ts preflight --source-run-id <inventory-run-id> --copy-run-id <copy-run-id-1> <copy-run-id-2>
```

Deletion stays gated behind a delete-eligible verification report and explicit confirmation:

```bash
npx tsx src/cli.ts delete --browser-cdp-url http://127.0.0.1:9222 --verification-run-id <verify-run-id> --confirm-delete
```

Deletion is intentionally fail-closed:

- subset verification can never authorize delete
- ambiguous source items can never authorize delete
- expected non-copyable source items also block delete until policy is resolved manually
- delete now expects an explicit `productionDeleteAuthorization` record inside the verification artifact
- legacy source snapshots and verification reports are intentionally incompatible until they are regenerated by the current CLI

Operational notes:

- long unbounded inventory runs now persist `inventory.json` before attempting the final screenshot
- a final screenshot timeout is logged as a warning and no longer destroys the source snapshot
- the watch-page save flow now polls for either a direct `Save` button or a `More actions -> Save` entry instead of committing to the first partial UI that appears
- auth loss now pauses `setup`, `copy`, `repair`, and `delete` instead of treating it as a normal retryable mutation failure
- a paused run writes `auth.paused` to `events.jsonl`, updates `checkpoint.json`, and sets the run status to `paused`
- `status` will now show `paused` when the latest run was stopped by auth loss

## Config

You can provide a JSON config file:

```bash
cp config.example.json config.local.json
```

Then run:

```bash
npm run doctor -- --config config.local.json
```

CLI flags override config values when both are provided.

## Build validation

The build now runs a live DOM smoke suite:

```bash
npm run test:live-dom
npm run build
```

By default the live smoke suite reads `config.local.json`. You can override that with `YOUTUBE_WATCHLIST_CONFIG=/absolute/path/to/config.json`.

The smoke suite fails the build when any of these checks break:

- authenticated YouTube session is missing or the wrong account is active
- Watch Later row selectors no longer resolve
- the Watch Later row action menu no longer exposes `Remove from Watch later`
- inventory extraction can no longer read playable video URLs from Watch Later rows
- the watch-page `Save` entry point or playlist panel no longer opens

Each run writes a JSON report and failure screenshots under `runs/live-dom-smoke-*/`.

## Docs

- [Authentication Workflow](/Users/malpern/local-code/youtube-cli/docs/authentication.md)
- [Implementation Plan](/Users/malpern/local-code/youtube-cli/docs/implementation-plan.md)
- [Performance Notes](/Users/malpern/local-code/youtube-cli/docs/performance.md)
- [ADR Index](/Users/malpern/local-code/youtube-cli/docs/adr/README.md)
