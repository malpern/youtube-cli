import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { formatStatusSummary, readRunStatus, resolveStatusRunId } from "./runStatus.js";

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "run-status-"));
  tempDirs.push(rootDir);
  fs.mkdirSync(path.join(rootDir, "runs"), { recursive: true });
  return rootDir;
}

function writeRunFile(rootDir: string, runId: string, fileName: string, contents: string): void {
  const runDir = path.join(rootDir, "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, fileName), contents);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("resolveStatusRunId", () => {
  it("returns the latest run when no explicit id is provided", () => {
    const rootDir = makeTempRoot();
    writeRunFile(rootDir, "older", "events.jsonl", "");
    writeRunFile(rootDir, "newer", "events.jsonl", "");
    fs.utimesSync(path.join(rootDir, "runs", "older"), new Date("2026-03-20T00:00:00Z"), new Date("2026-03-20T00:00:00Z"));
    fs.utimesSync(path.join(rootDir, "runs", "newer"), new Date("2026-03-21T00:00:00Z"), new Date("2026-03-21T00:00:00Z"));

    expect(resolveStatusRunId(rootDir)).toBe("newer");
  });
});

describe("readRunStatus", () => {
  it("summarizes checkpoint-backed copy progress with rate and eta", () => {
    const rootDir = makeTempRoot();
    writeRunFile(
      rootDir,
      "copy-a",
      "events.jsonl",
      [
        JSON.stringify({
          runId: "copy-a",
          phase: "copy",
          level: "info",
          eventType: "run.started",
          message: "Run started",
          createdAt: "2026-03-21T18:00:00.000Z"
        }),
        JSON.stringify({
          runId: "copy-a",
          phase: "copy",
          level: "info",
          eventType: "copy.progress",
          message: "Copy progress milestone",
          createdAt: "2026-03-21T18:05:00.000Z"
        })
      ].join("\n")
    );
    writeRunFile(
      rootDir,
      "copy-a",
      "checkpoint.json",
      `${JSON.stringify(
        {
          phase: "copy",
          updatedAt: "2026-03-21T18:05:00.000Z",
          processed: 25,
          total: 100,
          savedCount: 20,
          alreadySavedCount: 5
        },
        null,
        2
      )}\n`
    );

    const summary = readRunStatus(rootDir, "copy-a", new Date("2026-03-21T18:10:00.000Z"));

    expect(summary.status).toBe("running");
    expect(summary.progress).toEqual({
      processed: 25,
      total: 100,
      percent: 25,
      remaining: 75
    });
    expect(summary.throughput.itemsPerSecond).toBe(0.04);
    expect(summary.throughput.etaSeconds).toBe(1875);
    expect(summary.counters.savedCount).toBe(20);
  });

  it("uses the latest inventory scroll event when no checkpoint exists yet", () => {
    const rootDir = makeTempRoot();
    writeRunFile(
      rootDir,
      "inventory-a",
      "events.jsonl",
      [
        JSON.stringify({
          runId: "inventory-a",
          phase: "inventory",
          level: "info",
          eventType: "run.started",
          message: "Run started",
          createdAt: "2026-03-21T18:00:00.000Z"
        }),
        JSON.stringify({
          runId: "inventory-a",
          phase: "inventory",
          level: "info",
          eventType: "inventory.scroll-pass",
          message: "Inventory scroll pass",
          details: { pass: 12, rowCount: 1200, noGrowthPasses: 1 },
          createdAt: "2026-03-21T18:03:00.000Z"
        })
      ].join("\n")
    );

    const summary = readRunStatus(rootDir, "inventory-a", new Date("2026-03-21T18:04:00.000Z"));

    expect(summary.phase).toBe("inventory");
    expect(summary.progress.processed).toBe(1200);
    expect(summary.progress.total).toBeNull();
    expect(summary.counters.scrollPass).toBe(12);
    expect(summary.status).toBe("running");
  });

  it("formats a human-readable summary", () => {
    const output = formatStatusSummary({
      runId: "copy-a",
      runDir: "/tmp/copy-a",
      phase: "copy",
      status: "running",
      startedAt: "2026-03-21T18:00:00.000Z",
      updatedAt: "2026-03-21T18:05:00.000Z",
      elapsedSeconds: 600,
      lastEventType: "copy.progress",
      lastMessage: "Copy progress milestone",
      checkpointPhase: "copy",
      progress: {
        processed: 25,
        total: 100,
        percent: 25,
        remaining: 75
      },
      throughput: {
        itemsPerSecond: 0.04,
        etaSeconds: 1875
      },
      counters: {
        savedCount: 20,
        alreadySavedCount: 5
      }
    });

    expect(output).toContain("Phase: copy | Status: running");
    expect(output).toContain("Progress: 25 / 100 (25.00%)");
    expect(output).toContain("Rate: 0.04 items/sec | ETA: 31m 15s");
    expect(output).toContain("Counters: savedCount=20 | alreadySavedCount=5");
  });

  it("reports paused runs when auth loss was checkpointed", () => {
    const rootDir = makeTempRoot();
    writeRunFile(
      rootDir,
      "copy-paused",
      "events.jsonl",
      [
        JSON.stringify({
          runId: "copy-paused",
          phase: "copy",
          level: "info",
          eventType: "run.started",
          message: "Run started",
          createdAt: "2026-03-21T18:00:00.000Z"
        }),
        JSON.stringify({
          runId: "copy-paused",
          phase: "copy",
          level: "error",
          eventType: "auth.paused",
          message: "Paused because the YouTube session is no longer authenticated",
          createdAt: "2026-03-21T18:05:00.000Z"
        })
      ].join("\n")
    );
    writeRunFile(
      rootDir,
      "copy-paused",
      "checkpoint.json",
      `${JSON.stringify(
        {
          phase: "copy",
          updatedAt: "2026-03-21T18:05:00.000Z",
          processedCount: 25,
          total: 100,
          pauseReason: "auth-required",
          savedCount: 20
        },
        null,
        2
      )}\n`
    );

    const summary = readRunStatus(rootDir, "copy-paused", new Date("2026-03-21T18:10:00.000Z"));

    expect(summary.status).toBe("paused");
    expect(summary.lastEventType).toBe("auth.paused");
    expect(summary.progress.processed).toBe(25);
  });

  it("formats paused auth runs with an explicit resume hint", () => {
    const output = formatStatusSummary({
      runId: "copy-paused",
      runDir: "/tmp/copy-paused",
      phase: "copy",
      status: "paused",
      startedAt: "2026-03-21T18:00:00.000Z",
      updatedAt: "2026-03-21T18:05:00.000Z",
      elapsedSeconds: 300,
      lastEventType: "auth.paused",
      lastMessage: "Paused because the YouTube session is no longer authenticated",
      checkpointPhase: "copy",
      progress: {
        processed: 25,
        total: 100,
        percent: 25,
        remaining: 75
      },
      throughput: {
        itemsPerSecond: 0.08,
        etaSeconds: 9375
      },
      counters: {
        savedCount: 20
      }
    });

    expect(output).toContain("Phase: copy | Status: paused");
    expect(output).toContain("Paused: auth required | Sign in again in plain Chrome, then resume from checkpoint");
  });
});
