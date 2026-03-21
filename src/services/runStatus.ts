import fs from "node:fs";
import path from "node:path";

import { readCheckpointFile } from "./checkpointFile.js";
import type { CheckpointRecord, EventRecord, Phase } from "../models/types.js";

export interface RunStatusSummary {
  runId: string;
  runDir: string;
  phase: Phase | null;
  status: "running" | "paused" | "complete" | "failed" | "unknown";
  startedAt: string | null;
  updatedAt: string | null;
  elapsedSeconds: number | null;
  lastEventType: string | null;
  lastMessage: string | null;
  checkpointPhase: Phase | null;
  progress: {
    processed: number | null;
    total: number | null;
    percent: number | null;
    remaining: number | null;
  };
  throughput: {
    itemsPerSecond: number | null;
    etaSeconds: number | null;
  };
  counters: Record<string, number>;
}

export function resolveStatusRunId(rootDir: string, explicitRunId?: string): string {
  if (explicitRunId) {
    return explicitRunId;
  }

  const runsDir = path.join(rootDir, "runs");
  if (!fs.existsSync(runsDir)) {
    throw new Error("No runs directory exists yet.");
  }

  const latest = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const runDir = path.join(runsDir, entry.name);
      return {
        runId: entry.name,
        mtimeMs: fs.statSync(runDir).mtimeMs
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0];

  if (!latest) {
    throw new Error("No run directories were found.");
  }

  return latest.runId;
}

export function readRunStatus(rootDir: string, runId: string, now = new Date()): RunStatusSummary {
  const runDir = path.join(rootDir, "runs", runId);
  if (!fs.existsSync(runDir)) {
    throw new Error(`Run '${runId}' does not exist at ${runDir}`);
  }

  const events = readEvents(path.join(runDir, "events.jsonl"));
  const checkpoint = readCheckpointFile(path.join(runDir, "checkpoint.json"));
  const startedAt = events.find((event) => event.eventType === "run.started")?.createdAt ?? null;
  const lastEvent = events.at(-1) ?? null;
  const elapsedSeconds = startedAt ? Math.max((now.getTime() - new Date(startedAt).getTime()) / 1000, 0) : null;
  const progress = resolveProgress(lastEvent?.phase ?? checkpoint?.phase ?? null, checkpoint, lastEvent);
  const itemsPerSecond =
    elapsedSeconds && progress.processed && progress.processed > 0 ? Number((progress.processed / elapsedSeconds).toFixed(2)) : null;
  const etaSeconds =
    itemsPerSecond && progress.total !== null && progress.processed !== null && progress.total > progress.processed
      ? Math.round((progress.total - progress.processed) / itemsPerSecond)
      : null;

  return {
    runId,
    runDir,
    phase: (lastEvent?.phase ?? checkpoint?.phase ?? null) as Phase | null,
    status: resolveRunStatusFromEvents(lastEvent),
    startedAt,
    updatedAt: lastEvent?.createdAt ?? checkpoint?.updatedAt ?? null,
    elapsedSeconds,
    lastEventType: lastEvent?.eventType ?? null,
    lastMessage: lastEvent?.message ?? null,
    checkpointPhase: checkpoint?.phase ?? null,
    progress: {
      processed: progress.processed,
      total: progress.total,
      percent:
        progress.processed !== null && progress.total !== null && progress.total > 0
          ? Number(((progress.processed / progress.total) * 100).toFixed(2))
          : null,
      remaining:
        progress.processed !== null && progress.total !== null && progress.total >= progress.processed
          ? progress.total - progress.processed
          : null
    },
    throughput: {
      itemsPerSecond,
      etaSeconds
    },
    counters: progress.counters
  };
}

export function formatStatusSummary(summary: RunStatusSummary): string {
  const lines = [
    `Run: ${summary.runId}`,
    `Phase: ${summary.phase ?? "unknown"} | Status: ${summary.status}`,
    `Started: ${summary.startedAt ?? "unknown"} | Updated: ${summary.updatedAt ?? "unknown"}`,
    `Elapsed: ${formatDuration(summary.elapsedSeconds)}`
  ];

  if (summary.status === "paused" && summary.lastEventType === "auth.paused") {
    lines.push("Paused: auth required | Sign in again in plain Chrome, then resume from checkpoint");
  }

  if (summary.progress.processed !== null || summary.progress.total !== null) {
    lines.push(
      `Progress: ${formatCount(summary.progress.processed)} / ${formatCount(summary.progress.total)}${
        summary.progress.percent !== null ? ` (${summary.progress.percent.toFixed(2)}%)` : ""
      }`
    );
  }

  if (summary.throughput.itemsPerSecond !== null) {
    lines.push(
      `Rate: ${summary.throughput.itemsPerSecond.toFixed(2)} items/sec${
        summary.throughput.etaSeconds !== null ? ` | ETA: ${formatDuration(summary.throughput.etaSeconds)}` : ""
      }`
    );
  }

  const counterEntries = Object.entries(summary.counters).filter(([, value]) => value > 0);
  if (counterEntries.length > 0) {
    lines.push(`Counters: ${counterEntries.map(([key, value]) => `${key}=${value}`).join(" | ")}`);
  }

  if (summary.lastEventType || summary.lastMessage) {
    lines.push(`Last: ${summary.lastEventType ?? "unknown"}${summary.lastMessage ? ` | ${summary.lastMessage}` : ""}`);
  }

  return `${lines.join("\n")}\n`;
}

function readEvents(eventsPath: string): EventRecord[] {
  if (!fs.existsSync(eventsPath)) {
    return [];
  }

  return fs
    .readFileSync(eventsPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as EventRecord);
}

function resolveRunStatusFromEvents(lastEvent: EventRecord | null): RunStatusSummary["status"] {
  if (!lastEvent) {
    return "unknown";
  }

  if (lastEvent.eventType === "auth.paused" || lastEvent.eventType.endsWith(".paused")) {
    return "paused";
  }

  if (lastEvent.eventType.endsWith(".failed")) {
    return "failed";
  }

  if (lastEvent.eventType.endsWith(".complete") || lastEvent.eventType === "repair.noop") {
    return "complete";
  }

  return "running";
}

function resolveProgress(
  phase: Phase | null,
  checkpoint: CheckpointRecord | null,
  lastEvent: EventRecord | null
): { processed: number | null; total: number | null; counters: Record<string, number> } {
  if (!phase) {
    return { processed: null, total: null, counters: {} };
  }

  if ((phase === "copy" || phase === "repair" || phase === "delete") && checkpoint) {
    return {
      processed: readNumericField(checkpoint, "processedCount", readNumericField(checkpoint, "processed")),
      total: readNumericField(checkpoint, "total"),
      counters: readCounterFields(checkpoint.payload)
    };
  }

  if (phase === "inventory" && lastEvent?.eventType === "inventory.scroll-pass") {
    return {
      processed: readNumericValue(lastEvent.details?.rowCount),
      total: null,
      counters: {
        scrollPass: readNumericValue(lastEvent.details?.pass) ?? 0,
        noGrowthPasses: readNumericValue(lastEvent.details?.noGrowthPasses) ?? 0
      }
    };
  }

  if (phase === "inventory" && checkpoint) {
    return {
      processed: readNumericField(checkpoint, "total"),
      total: readNumericField(checkpoint, "total"),
      counters: readCounterFields(checkpoint.payload)
    };
  }

  return { processed: null, total: null, counters: {} };
}

function readCounterFields(payload: Record<string, unknown>): Record<string, number> {
  const counters: Record<string, number> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== "number") {
      continue;
    }

    if (
      key.endsWith("Count") ||
      key === "processed" ||
      key === "total" ||
      key === "scrollPasses" ||
      key === "targetMismatchCount" ||
      key === "driftMismatchCount"
    ) {
      counters[key] = value;
    }
  }

  return counters;
}

function readNumericField(checkpoint: CheckpointRecord, key: string, fallback: number | null = null): number | null {
  const value = readNumericValue(checkpoint.payload[key]);
  return value === null ? fallback : value;
}

function readNumericValue(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "unknown";
  }

  const rounded = Math.max(Math.round(seconds), 0);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}

function formatCount(value: number | null): string {
  return value === null ? "?" : String(value);
}
