# Performance Notes

This document captures measured copy performance from live authenticated YouTube runs.

## Regenerate

Use the built-in analyzer against completed copy runs:

```bash
npx tsx src/cli.ts copy-performance \
  --copy-run-id <copy-run-id-1> <copy-run-id-2> ...
```

Newer copy runs may also include per-step save timings in the same report:

- `timingSampleCount`
- `timingBreakdownByStep`
- `timingBreakdownByResult`

Older runs remain valid inputs, but those fields will be empty when the source `copy-operations.jsonl` did not record step timings yet.

Latest aggregate report:

- [copy-performance.json](/Users/malpern/local-code/youtube-watchlist/runs/2026-03-21T16-03-23-713Z-ddrmnl/copy-performance.json)
- backward-compatible re-analysis of the speed-pass runs:
  - [copy-performance.json](/Users/malpern/local-code/youtube-watchlist/runs/2026-03-21T19-23-08-790Z-sgbk6o/copy-performance.json)

## Latest measured runs

Source snapshot:

- [2026-03-21T15-48-08-531Z-42r2i3](/Users/malpern/local-code/youtube-watchlist/runs/2026-03-21T15-48-08-531Z-42r2i3)

Measured copy runs:

- mixed run, `10 already-saved + 15 saved`:
  - [2026-03-21T15-48-26-211Z-wrelvg](/Users/malpern/local-code/youtube-watchlist/runs/2026-03-21T15-48-26-211Z-wrelvg)
- no-op run, `25 already-saved`:
  - [2026-03-21T15-53-33-484Z-w5qpye](/Users/malpern/local-code/youtube-watchlist/runs/2026-03-21T15-53-33-484Z-w5qpye)
- no-op run, `25 already-saved`:
  - [2026-03-21T16-01-07-497Z-g9fje8](/Users/malpern/local-code/youtube-watchlist/runs/2026-03-21T16-01-07-497Z-g9fje8)
- mixed run, `25 already-saved + 25 saved`:
  - [2026-03-21T16-09-28-794Z-2t9bq4](/Users/malpern/local-code/youtube-watchlist/runs/2026-03-21T16-09-28-794Z-2t9bq4)

## Findings

### Mixed run: real save work is much slower than idempotent checks

- total time for `25` items: `275.07s` or about `4m 35s`
- overall rate: `0.09 items/sec`
- per-item latency across the whole mixed run:
  - mean `11.00s`
  - median `13.95s`
  - p95 `16.13s`
- `already-saved` items in that run:
  - mean `5.24s`
  - p95 `5.99s`
  - stddev `0.60s`
- `saved` items in that run:
  - mean `14.84s`
  - p95 `16.71s`
  - stddev `1.02s`

### No-op runs: the idempotent path is materially faster and fairly stable

Run `2026-03-21T15-53-33-484Z-w5qpye`:

- total time: `121.29s` or about `2m 01s`
- overall rate: `0.21 items/sec`
- per-item mean: `4.85s`
- p95: `5.74s`
- stddev: `0.55s`

Run `2026-03-21T16-01-07-497Z-g9fje8`:

- total time: `127.88s` or about `2m 08s`
- overall rate: `0.20 items/sec`
- per-item mean: `5.11s`
- p95: `5.69s`
- stddev: `1.52s`

Across both no-op runs:

- total run time varied by `6.58s` over `25` items, about `5.4%`
- mean per-item latency varied by `0.26s`, about `5.4%`
- startup latency stayed in a tight band:
  - `4.85s`
  - `5.76s`

### Aggregate view across all three runs

- startup latency mean: `5.47s`
- completion overhead mean: `3.33ms`
- all-item latency mean: `6.99s`
- all-item latency p95: `15.14s`

### 50-item scale check

50-item source snapshot:

- [2026-03-21T16-09-14-720Z-a8eoek](/Users/malpern/local-code/youtube-watchlist/runs/2026-03-21T16-09-14-720Z-a8eoek)

50-item copy run:

- [2026-03-21T16-09-28-794Z-2t9bq4](/Users/malpern/local-code/youtube-watchlist/runs/2026-03-21T16-09-28-794Z-2t9bq4)

50-item verify run:

- [2026-03-21T16-18-06-290Z-z3412v](/Users/malpern/local-code/youtube-watchlist/runs/2026-03-21T16-18-06-290Z-z3412v)

50-item performance report:

- [2026-03-21T16-18-18-063Z-573ri8/copy-performance.json](/Users/malpern/local-code/youtube-watchlist/runs/2026-03-21T16-18-18-063Z-573ri8/copy-performance.json)

Measured result:

- total time for `50` items: `511.51s` or about `8m 32s`
- overall rate: `0.10 items/sec`
- mix: `25 already-saved`, `25 saved`
- overall per-item mean: `10.23s`
- overall p95: `16.08s`

Split by result type:

- `already-saved`
  - mean `4.98s`
  - p95 `5.53s`
  - stddev `0.31s`
- `saved`
  - mean `15.48s`
  - median `14.83s`
  - p95 `16.20s`
  - stddev `2.75s`

Comparison to the 25-item mixed run:

- the `already-saved` path stayed essentially flat:
  - `5.24s` mean at `25`
  - `4.98s` mean at `50`
- the `saved` path stayed in the same band but got a little noisier:
  - `14.84s` mean at `25`
  - `15.48s` mean at `50`
- one outlier reached `28.59s`, so the long tail on the `saved` path is real even when the median remains stable

## What this means

- A first-time full migration will behave much closer to the `saved` path than the no-op path.
- Based on the measured `saved` means of `14.84s` at `25` items and `15.48s` at `50` items, a fully copyable `5,000` item run would be roughly `20.6` to `21.5` hours if the save path remains approximately linear.
- The no-op path is much cheaper at about `5s` per item, which is useful for resume and repair.
- The measured no-op variability is acceptable.
- The `saved` path appears broadly stable through `50` items, but the outlier tail has widened enough that future deletion and full-run planning should assume occasional `20s+` item latencies.
- The next live run should produce substep timing breakdowns automatically, which will let us answer whether `goto`, UI readiness, panel entry, selection, or reopen-confirm dominates the `saved` path.
