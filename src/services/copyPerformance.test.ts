import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { analyzeCopyPerformanceRun, analyzeCopyPerformanceRuns, computeNumericStats } from "./copyPerformance.js";

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "copy-performance-"));
  tempDirs.push(rootDir);
  fs.mkdirSync(path.join(rootDir, "runs"), { recursive: true });
  return rootDir;
}

function writeRun(rootDir: string, runId: string, args: { startedAt: string; completedAt: string; items: Array<{ result: string; createdAt: string }> }): void {
  const runDir = path.join(rootDir, "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const events = [
    {
      runId,
      phase: "copy",
      level: "info",
      eventType: "run.started",
      message: "Run started",
      createdAt: args.startedAt
    },
    ...args.items.map((item, index) => ({
      runId,
      phase: "copy",
      level: "info",
      eventType: "copy.item",
      message: "Processed copy item",
      details: {
        sourceIndex: index + 1,
        result: item.result
      },
      createdAt: item.createdAt
    })),
    {
      runId,
      phase: "copy",
      level: "info",
      eventType: "copy.complete",
      message: "Copy pass completed",
      createdAt: args.completedAt
    }
  ];
  const operations = args.items.map((item, index) => ({
    sourceIndex: index + 1,
    result: item.result,
    timestamp: item.createdAt
  }));

  fs.writeFileSync(path.join(runDir, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  fs.writeFileSync(path.join(runDir, "copy-operations.jsonl"), `${operations.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("computeNumericStats", () => {
  it("returns empty stats for an empty input", () => {
    expect(computeNumericStats([])).toEqual({
      count: 0,
      min: null,
      max: null,
      mean: null,
      median: null,
      p95: null,
      stddev: null
    });
  });

  it("computes rounded summary stats", () => {
    expect(computeNumericStats([1000, 2000, 4000])).toEqual({
      count: 3,
      min: 1000,
      max: 4000,
      mean: 2333.33,
      median: 2000,
      p95: 3800,
      stddev: 1247.22
    });
  });
});

describe("analyzeCopyPerformanceRun", () => {
  it("computes total duration, rate, and per-result latencies from run artifacts", () => {
    const rootDir = makeTempRoot();
    writeRun(rootDir, "run-a", {
      startedAt: "2026-03-21T15:00:00.000Z",
      completedAt: "2026-03-21T15:00:12.000Z",
      items: [
        { result: "already-saved", createdAt: "2026-03-21T15:00:03.000Z" },
        { result: "saved", createdAt: "2026-03-21T15:00:08.000Z" }
      ]
    });

    expect(analyzeCopyPerformanceRun(rootDir, "run-a")).toEqual({
      runId: "run-a",
      startedAt: "2026-03-21T15:00:00.000Z",
      completedAt: "2026-03-21T15:00:12.000Z",
      itemCount: 2,
      resultCounts: {
        "already-saved": 1,
        saved: 1
      },
      totalDurationMs: 12000,
      startupLatencyMs: 3000,
      completionOverheadMs: 4000,
      overallRateItemsPerSecond: 0.17,
      itemLatencyMs: {
        count: 2,
        min: 3000,
        max: 5000,
        mean: 4000,
        median: 4000,
        p95: 4900,
        stddev: 1000
      },
      itemLatencyByResult: {
        "already-saved": {
          count: 1,
          min: 3000,
          max: 3000,
          mean: 3000,
          median: 3000,
          p95: 3000,
          stddev: 0
        },
        saved: {
          count: 1,
          min: 5000,
          max: 5000,
          mean: 5000,
          median: 5000,
          p95: 5000,
          stddev: 0
        }
      }
    });
  });
});

describe("analyzeCopyPerformanceRuns", () => {
  it("aggregates across multiple runs using the raw latency samples", () => {
    const rootDir = makeTempRoot();
    writeRun(rootDir, "run-a", {
      startedAt: "2026-03-21T15:00:00.000Z",
      completedAt: "2026-03-21T15:00:12.000Z",
      items: [
        { result: "already-saved", createdAt: "2026-03-21T15:00:03.000Z" },
        { result: "saved", createdAt: "2026-03-21T15:00:08.000Z" }
      ]
    });
    writeRun(rootDir, "run-b", {
      startedAt: "2026-03-21T16:00:00.000Z",
      completedAt: "2026-03-21T16:00:06.000Z",
      items: [
        { result: "already-saved", createdAt: "2026-03-21T16:00:02.000Z" },
        { result: "already-saved", createdAt: "2026-03-21T16:00:04.000Z" }
      ]
    });

    const report = analyzeCopyPerformanceRuns(rootDir, ["run-a", "run-b"]);

    expect(report.analyzedRunIds).toEqual(["run-a", "run-b"]);
    expect(report.aggregate.totalDurationMs.mean).toBe(9000);
    expect(report.aggregate.overallRateItemsPerSecond.mean).toBe(0.25);
    expect(report.aggregate.itemLatencyMs.mean).toBe(3000);
    expect(report.aggregate.itemLatencyByResult["already-saved"]).toEqual({
      count: 3,
      min: 2000,
      max: 3000,
      mean: 2333.33,
      median: 2000,
      p95: 2900,
      stddev: 471.4
    });
    expect(report.aggregate.itemLatencyByResult.saved).toEqual({
      count: 1,
      min: 5000,
      max: 5000,
      mean: 5000,
      median: 5000,
      p95: 5000,
      stddev: 0
    });
  });
});
