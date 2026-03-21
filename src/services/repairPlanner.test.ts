import { describe, expect, it } from "vitest";

import type { InventoryItem } from "../models/types.js";
import { planRepair } from "./repairPlanner.js";
import type { VerificationReport } from "./verificationReport.js";

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

function makeReport(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return {
    sourceSnapshotRunId: "snapshot-a",
    sourceSnapshotPath: "/tmp/inventory.json",
    targetPlaylist: "Old Watch",
    passed: false,
    targetPassed: false,
    driftPassed: true,
    ambiguousSourceCount: 0,
    targetMismatches: [],
    targetDiscrepancySummary: {
      missingOccurrenceKeys: [],
      extraOccurrenceKeys: [],
      orderMismatchCount: 0,
      orderMismatches: []
    },
    ...overrides
  };
}

describe("planRepair", () => {
  it("collects retry indices from target mismatches and discrepancy summaries", () => {
    const plan = planRepair(
      makeReport({
        targetMismatches: [
          { sourceIndex: 2, field: "missing-target-item", expected: "video-2", actual: null },
          { sourceIndex: 4, field: "title", expected: "A", actual: "B" }
        ],
        targetDiscrepancySummary: {
          missingOccurrenceKeys: ["video-3#1"],
          extraOccurrenceKeys: [],
          orderMismatchCount: 1,
          orderMismatches: [{ sourceIndex: 5, expectedOccurrenceKey: "video-5#1", actualOccurrenceKey: "video-6#1" }]
        }
      }),
      [makeItem(1), makeItem(2), makeItem(3), makeItem(4), makeItem(5)]
    );

    expect(plan).toEqual({
      blockedReasons: [],
      sourceIndicesToRetry: [2, 3, 4, 5]
    });
  });

  it("blocks repair when drift failed or ambiguous source items are present", () => {
    const plan = planRepair(
      makeReport({
        driftPassed: false,
        ambiguousSourceCount: 1
      }),
      [makeItem(1)]
    );

    expect(plan).toEqual({
      blockedReasons: ["source-drift-verification-failed", "ambiguous-source-items-present"],
      sourceIndicesToRetry: []
    });
  });

  it("ignores ambiguous-source mismatches for retry selection", () => {
    const plan = planRepair(
      makeReport({
        targetMismatches: [{ sourceIndex: 7, field: "ambiguous-source-item", expected: "unknown", actual: null }]
      }),
      [makeItem(7)]
    );

    expect(plan).toEqual({
      blockedReasons: [],
      sourceIndicesToRetry: []
    });
  });
});
