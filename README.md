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

Recommended authenticated development flow:

1. Open plain Chrome on the dedicated profile with a remote debugging port.
2. Sign in to YouTube manually.
3. Keep that browser open.
4. Run CLI commands against `--browser-cdp-url http://127.0.0.1:9222`.

Environment check:

```bash
npx tsx src/cli.ts doctor --browser-cdp-url http://127.0.0.1:9222
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

Ensure the target playlist exists:

```bash
npx tsx src/cli.ts setup --browser-cdp-url http://127.0.0.1:9222 --target-playlist "Old Watch"
```

Copy from a specific source snapshot first:

```bash
npx tsx src/cli.ts copy --browser-cdp-url http://127.0.0.1:9222 --source-run-id <inventory-run-id> --target-playlist "Old Watch" --max-items 10
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

## Docs

- [Authentication Workflow](/Users/malpern/local-code/youtube-watchlist/docs/authentication.md)
- [Implementation Plan](/Users/malpern/local-code/youtube-watchlist/docs/implementation-plan.md)
- [Performance Notes](/Users/malpern/local-code/youtube-watchlist/docs/performance.md)
- [ADR Index](/Users/malpern/local-code/youtube-watchlist/docs/adr/README.md)
