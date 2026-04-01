import { describe, expect, it } from "vitest";

import type { CopyPerformanceReport, InventoryItem, SourceSnapshot } from "../models/types.js";
import { buildFullRunPreflightReport } from "./fullRunPreflight.js";
import { computeInventoryFingerprint } from "./sourceSnapshot.js";

function makeItem(sourceIndex: number, overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    sourceIndex,
    title: `Video ${sourceIndex}`,
    videoUrl: `https://www.youtube.com/watch?v=video-${sourceIndex}`,
    videoId: `video-${sourceIndex}`,
    channelName: "Channel",
    metadataText: null,
    unavailableKind: "none",
    ...overrides
  };
}

function makeSnapshot(items: InventoryItem[], overrides: Partial<SourceSnapshot> = {}): SourceSnapshot {
  return {
    runId: "snapshot-a",
    currentUrl: "https://www.youtube.com/playlist?list=WL",
    capturedAt: "2026-03-21T00:00:00.000Z",
    metadataVersion: 1,
    metadataComplete: true,
    total: items.length,
    scrollPasses: 10,
    requestedMaxItems: null,
    bounded: false,
    fingerprint: computeInventoryFingerprint(items),
    items,
    ...overrides
  };
}

function makePerformanceReport(overrides: Partial<CopyPerformanceReport> = {}): CopyPerformanceReport {
  return {
    generatedAt: "2026-03-21T00:00:00.000Z",
    analyzedRunIds: ["copy-a"],
    runReports: [],
    aggregate: {
      totalDurationMs: { count: 1, min: 10, max: 10, mean: 10, median: 10, p95: 10, stddev: 0 },
      startupLatencyMs: { count: 1, min: 1, max: 1, mean: 1, median: 1, p95: 1, stddev: 0 },
      completionOverheadMs: { count: 1, min: 1, max: 1, mean: 1, median: 1, p95: 1, stddev: 0 },
      overallRateItemsPerSecond: { count: 1, min: 1, max: 1, mean: 1, median: 1, p95: 1, stddev: 0 },
      itemLatencyMs: { count: 1, min: 1000, max: 1000, mean: 1000, median: 1000, p95: 1000, stddev: 0 },
      itemLatencyByResult: {
        saved: { count: 1, min: 15000, max: 15000, mean: 15000, median: 15000, p95: 16000, stddev: 0 }
      },
      timingBreakdownByStep: {},
      timingBreakdownByResult: {}
    },
    ...overrides
  };
}

describe("buildFullRunPreflightReport", () => {
  it("uses saved-item latency as the primary baseline", () => {
    const report = buildFullRunPreflightReport({
      sourceSnapshot: makeSnapshot([makeItem(1), makeItem(2)]),
      performanceReport: makePerformanceReport()
    });

    expect(report.snapshotEligibleForProductionAuthorization).toBe(true);
    expect(report.sourceSnapshotMetadataVersion).toBe(1);
    expect(report.sourceSnapshotMetadataComplete).toBe(true);
    expect(report.latencyBasis).toEqual({
      resultBucket: "saved",
      meanMsPerItem: 15000,
      p95MsPerItem: 16000
    });
    expect(report.estimatedCopyDuration).toEqual({
      meanSeconds: 30,
      meanHours: 0.01,
      p95Seconds: 32,
      p95Hours: 0.01
    });
  });

  it("falls back to overall latency when there is no saved baseline", () => {
    const performanceReport = makePerformanceReport({
      aggregate: {
        totalDurationMs: { count: 1, min: 10, max: 10, mean: 10, median: 10, p95: 10, stddev: 0 },
        startupLatencyMs: { count: 1, min: 1, max: 1, mean: 1, median: 1, p95: 1, stddev: 0 },
        completionOverheadMs: { count: 1, min: 1, max: 1, mean: 1, median: 1, p95: 1, stddev: 0 },
        overallRateItemsPerSecond: { count: 1, min: 1, max: 1, mean: 1, median: 1, p95: 1, stddev: 0 },
        itemLatencyMs: { count: 1, min: 5000, max: 5000, mean: 5000, median: 5000, p95: 6000, stddev: 0 },
        itemLatencyByResult: {},
        timingBreakdownByStep: {},
        timingBreakdownByResult: {}
      }
    });

    const report = buildFullRunPreflightReport({
      sourceSnapshot: makeSnapshot([makeItem(1)]),
      performanceReport
    });

    expect(report.latencyBasis).toEqual({
      resultBucket: "overall",
      meanMsPerItem: 5000,
      p95MsPerItem: 6000
    });
  });

  it("marks bounded and policy-blocked snapshots as not eligible", () => {
    const report = buildFullRunPreflightReport({
      sourceSnapshot: makeSnapshot(
        [
          makeItem(1),
          makeItem(2, { videoId: null, videoUrl: null, unavailableKind: "deleted" }),
          makeItem(3, { videoId: null, videoUrl: null, unavailableKind: "unknown" })
        ],
        { bounded: true, requestedMaxItems: 3 }
      ),
      performanceReport: makePerformanceReport()
    });

    expect(report.snapshotEligibleForProductionAuthorization).toBe(false);
    expect(report.snapshotBlockingReasons).toEqual([
      "source-snapshot-was-bounded",
      "ambiguous-source-items-present",
      "expected-non-copyable-source-items-present"
    ]);
  });

  it("blocks legacy snapshots with incomplete metadata", () => {
    const report = buildFullRunPreflightReport({
      sourceSnapshot: makeSnapshot([makeItem(1)], {
        metadataVersion: null,
        metadataComplete: false
      }),
      performanceReport: makePerformanceReport()
    });

    expect(report.snapshotEligibleForProductionAuthorization).toBe(false);
    expect(report.snapshotBlockingReasons).toEqual([
      "source-snapshot-metadata-incomplete"
    ]);
  });
});
