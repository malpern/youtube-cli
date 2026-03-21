import fs from "node:fs";
import path from "node:path";

import type { CopyPerformanceReport, CopyPerformanceRunReport, EventRecord, NumericStats } from "../models/types.js";
import { isoNow } from "../utils/time.js";

interface CopyOperationRecord {
  sourceIndex: number;
  result: string;
  timestamp: string;
}

interface CopyPerformanceRunAnalysis {
  report: CopyPerformanceRunReport;
  itemLatencies: number[];
  itemLatenciesByResult: Record<string, number[]>;
}

function readJsonLines<T>(filePath: string): T[] {
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return [];
  }

  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

function toTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

export function computeNumericStats(values: number[]): NumericStats {
  if (values.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      mean: null,
      median: null,
      p95: null,
      stddev: null
    };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;

  return {
    count: sorted.length,
    min: round(sorted[0]!),
    max: round(sorted[sorted.length - 1]!),
    mean: round(mean),
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    stddev: round(Math.sqrt(variance))
  };
}

function percentile(sortedValues: number[], percentileValue: number): number {
  if (sortedValues.length === 1) {
    return sortedValues[0]!;
  }

  const position = (sortedValues.length - 1) * percentileValue;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lowerValue = sortedValues[lowerIndex]!;
  const upperValue = sortedValues[upperIndex]!;

  if (lowerIndex === upperIndex) {
    return lowerValue;
  }

  const weight = position - lowerIndex;
  return lowerValue + (upperValue - lowerValue) * weight;
}

function buildLatencySeries(startedAtMs: number | null, operations: CopyOperationRecord[]): number[] {
  return operations.map((operation, index) => {
    const currentTimestamp = toTimestamp(operation.timestamp);
    if (currentTimestamp === null) {
      return 0;
    }

    if (index === 0) {
      return startedAtMs === null ? 0 : currentTimestamp - startedAtMs;
    }

    const previousTimestamp = toTimestamp(operations[index - 1]?.timestamp);
    return previousTimestamp === null ? 0 : currentTimestamp - previousTimestamp;
  });
}

function findLastEvent(events: EventRecord[], eventType: string): EventRecord | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.eventType === eventType) {
      return event;
    }
  }

  return undefined;
}

function analyzeCopyPerformanceRunInternal(rootDir: string, runId: string): CopyPerformanceRunAnalysis {
  const runDir = path.join(rootDir, "runs", runId);
  const eventsPath = path.join(runDir, "events.jsonl");
  const operationsPath = path.join(runDir, "copy-operations.jsonl");

  if (!fs.existsSync(eventsPath)) {
    throw new Error(`Copy performance analysis could not find events.jsonl for run '${runId}'`);
  }

  if (!fs.existsSync(operationsPath)) {
    throw new Error(`Copy performance analysis could not find copy-operations.jsonl for run '${runId}'`);
  }

  const events = readJsonLines<EventRecord>(eventsPath);
  const operations = readJsonLines<CopyOperationRecord>(operationsPath);
  const startedAt = events.find((event) => event.eventType === "run.started")?.createdAt ?? null;
  const completedAt = findLastEvent(events, "copy.complete")?.createdAt ?? null;
  const startedAtMs = toTimestamp(startedAt);
  const completedAtMs = toTimestamp(completedAt);
  const firstItemTimestampMs = toTimestamp(operations[0]?.timestamp);
  const lastItemTimestampMs = toTimestamp(operations[operations.length - 1]?.timestamp);
  const itemLatencies = buildLatencySeries(startedAtMs, operations);
  const resultCounts = operations.reduce<Record<string, number>>((counts, operation) => {
    counts[operation.result] = (counts[operation.result] ?? 0) + 1;
    return counts;
  }, {});
  const itemLatenciesByResult = operations.reduce<Record<string, number[]>>((groups, operation, index) => {
    const latency = itemLatencies[index] ?? 0;
    const group = groups[operation.result] ?? [];
    group.push(latency);
    groups[operation.result] = group;
    return groups;
  }, {});

  return {
    itemLatencies,
    itemLatenciesByResult,
    report: {
    runId,
    startedAt,
    completedAt,
    itemCount: operations.length,
    resultCounts,
    totalDurationMs:
      startedAtMs !== null && completedAtMs !== null
        ? round(completedAtMs - startedAtMs)
        : null,
    startupLatencyMs:
      startedAtMs !== null && firstItemTimestampMs !== null
        ? round(firstItemTimestampMs - startedAtMs)
        : null,
    completionOverheadMs:
      completedAtMs !== null && lastItemTimestampMs !== null
        ? round(completedAtMs - lastItemTimestampMs)
        : null,
    overallRateItemsPerSecond:
      startedAtMs !== null && completedAtMs !== null && completedAtMs > startedAtMs
        ? round(operations.length / ((completedAtMs - startedAtMs) / 1000))
        : null,
    itemLatencyMs: computeNumericStats(itemLatencies),
    itemLatencyByResult: Object.fromEntries(
      Object.entries(itemLatenciesByResult).map(([result, latencies]) => [result, computeNumericStats(latencies)])
    )
    }
  };
}

export function analyzeCopyPerformanceRun(rootDir: string, runId: string): CopyPerformanceRunReport {
  return analyzeCopyPerformanceRunInternal(rootDir, runId).report;
}

export function analyzeCopyPerformanceRuns(rootDir: string, runIds: string[]): CopyPerformanceReport {
  const analyses = runIds.map((runId) => analyzeCopyPerformanceRunInternal(rootDir, runId));
  const runReports = analyses.map((analysis) => analysis.report);
  const aggregateItemLatencies = analyses.flatMap((analysis) => analysis.itemLatencies);
  const aggregateItemLatenciesByResult = analyses.reduce<Record<string, number[]>>((groups, analysis) => {
    for (const [result, values] of Object.entries(analysis.itemLatenciesByResult)) {
      groups[result] = [...(groups[result] ?? []), ...values];
    }

    return groups;
  }, {});

  return {
    generatedAt: isoNow(),
    analyzedRunIds: runIds,
    runReports,
    aggregate: {
      totalDurationMs: computeNumericStats(runReports.flatMap((report) => nullableToArray(report.totalDurationMs))),
      startupLatencyMs: computeNumericStats(runReports.flatMap((report) => nullableToArray(report.startupLatencyMs))),
      completionOverheadMs: computeNumericStats(runReports.flatMap((report) => nullableToArray(report.completionOverheadMs))),
      overallRateItemsPerSecond: computeNumericStats(runReports.flatMap((report) => nullableToArray(report.overallRateItemsPerSecond))),
      itemLatencyMs: computeNumericStats(aggregateItemLatencies),
      itemLatencyByResult: Object.fromEntries(
        Object.entries(aggregateItemLatenciesByResult).map(([result, values]) => [result, computeNumericStats(values)])
      )
    }
  };
}

function nullableToArray(value: number | null): number[] {
  return value === null ? [] : [value];
}
