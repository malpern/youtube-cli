import type { CopyPerformanceReport, FullRunPreflightReport, NumericStats, SourceSnapshot } from "../models/types.js";
import { partitionSourceItems } from "./sourceSnapshot.js";

function round(value: number): number {
  return Number(value.toFixed(2));
}

function pickLatencyBasis(report: CopyPerformanceReport): { resultBucket: string | null; stats: NumericStats | null } {
  const savedStats = report.aggregate.itemLatencyByResult.saved;
  if (savedStats && savedStats.count > 0) {
    return { resultBucket: "saved", stats: savedStats };
  }

  const overallStats = report.aggregate.itemLatencyMs;
  if (overallStats.count > 0) {
    return { resultBucket: "overall", stats: overallStats };
  }

  return { resultBucket: null, stats: null };
}

export function buildFullRunPreflightReport(args: {
  sourceSnapshot: SourceSnapshot;
  performanceReport: CopyPerformanceReport;
}): FullRunPreflightReport {
  const partitioned = partitionSourceItems(args.sourceSnapshot.items);
  const blockingReasons: string[] = [];

  if (args.sourceSnapshot.bounded) {
    blockingReasons.push("source-snapshot-was-bounded");
  }

  if (!args.sourceSnapshot.metadataComplete) {
    blockingReasons.push("source-snapshot-metadata-incomplete");
  }

  if (partitioned.ambiguousItems.length > 0) {
    blockingReasons.push("ambiguous-source-items-present");
  }

  if (partitioned.expectedNonCopyableItems.length > 0) {
    blockingReasons.push("expected-non-copyable-source-items-present");
  }

  const basis = pickLatencyBasis(args.performanceReport);
  const copyableCount = partitioned.copyableItems.length;
  const meanMsPerItem = basis.stats?.mean ?? null;
  const p95MsPerItem = basis.stats?.p95 ?? null;
  const meanSeconds = meanMsPerItem === null ? null : round((copyableCount * meanMsPerItem) / 1000);
  const p95Seconds = p95MsPerItem === null ? null : round((copyableCount * p95MsPerItem) / 1000);

  return {
    generatedAt: new Date().toISOString(),
    sourceSnapshotRunId: args.sourceSnapshot.runId,
    sourceSnapshotMetadataVersion: args.sourceSnapshot.metadataVersion,
    sourceSnapshotMetadataComplete: args.sourceSnapshot.metadataComplete,
    sourceTotal: args.sourceSnapshot.total,
    sourceSnapshotBounded: args.sourceSnapshot.bounded,
    sourceSnapshotRequestedMaxItems: args.sourceSnapshot.requestedMaxItems,
    copyableCount,
    expectedNonCopyableCount: partitioned.expectedNonCopyableItems.length,
    ambiguousCount: partitioned.ambiguousItems.length,
    snapshotEligibleForProductionAuthorization: blockingReasons.length === 0,
    snapshotBlockingReasons: blockingReasons,
    performanceBaselineRunIds: args.performanceReport.analyzedRunIds,
    latencyBasis: {
      resultBucket: basis.resultBucket,
      meanMsPerItem,
      p95MsPerItem
    },
    estimatedCopyDuration: {
      meanSeconds,
      meanHours: meanSeconds === null ? null : round(meanSeconds / 3600),
      p95Seconds,
      p95Hours: p95Seconds === null ? null : round(p95Seconds / 3600)
    }
  };
}
