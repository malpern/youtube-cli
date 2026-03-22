import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { InventoryItem } from "../models/types.js";
import {
  analyzeInventoryDiscrepancies,
  buildProductionDeleteAuthorization,
  compareOrderedPrefix,
  discrepanciesAreClear,
  evaluateDeletionEligibility,
  evaluateVerificationCounts,
  findMatchingWindowStart,
  readVerificationReport
} from "./verification.js";

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

describe("compareOrderedPrefix", () => {
  it("returns no mismatches for identical ordered items", () => {
    const source = [makeItem(1), makeItem(2)];
    const target = [makeItem(1), makeItem(2)];

    expect(compareOrderedPrefix(source, target)).toEqual([]);
  });

  it("reports a missing target item when the target is shorter", () => {
    const mismatches = compareOrderedPrefix([makeItem(1), makeItem(2)], [makeItem(1)]);

    expect(mismatches).toEqual([
      {
        sourceIndex: 2,
        field: "missing-target-item",
        expected: "video-2",
        actual: null
      }
    ]);
  });

  it("reports a video id mismatch before checking title", () => {
    const mismatches = compareOrderedPrefix([makeItem(1)], [makeItem(1, { videoId: "video-x", videoUrl: "https://www.youtube.com/watch?v=video-x" })]);

    expect(mismatches).toEqual([
      {
        sourceIndex: 1,
        field: "videoId",
        expected: "video-1",
        actual: "video-x"
      }
    ]);
  });

  it("falls back to title matching when no video ids exist", () => {
    const mismatches = compareOrderedPrefix(
      [makeItem(1, { videoId: null, videoUrl: null, title: "Same Title" })],
      [makeItem(1, { videoId: null, videoUrl: null, title: " same   title " })]
    );

    expect(mismatches).toEqual([]);
  });

  it("reports a title mismatch when normalized titles differ", () => {
    const mismatches = compareOrderedPrefix(
      [makeItem(1, { videoId: null, videoUrl: null, title: "Alpha" })],
      [makeItem(1, { videoId: null, videoUrl: null, title: "Beta" })]
    );

    expect(mismatches).toEqual([
      {
        sourceIndex: 1,
        field: "title",
        expected: "Alpha",
        actual: "Beta"
      }
    ]);
  });
});

describe("evaluateVerificationCounts", () => {
  it("uses exact counts for full verification runs", () => {
    expect(
      evaluateVerificationCounts({
        subsetLimit: undefined,
        sourceCount: 10,
        targetCount: 10,
        driftCount: 10
      })
    ).toEqual({
      targetCountMatches: true,
      driftCountMatches: true
    });

    expect(
      evaluateVerificationCounts({
        subsetLimit: undefined,
        sourceCount: 10,
        targetCount: 11,
        driftCount: 10
      })
    ).toEqual({
      targetCountMatches: false,
      driftCountMatches: true
    });
  });

  it("allows target and drift counts to be greater than the source count for subset verification", () => {
    expect(
      evaluateVerificationCounts({
        subsetLimit: 10,
        sourceCount: 10,
        targetCount: 25,
        driftCount: 50
      })
    ).toEqual({
      targetCountMatches: true,
      driftCountMatches: true
    });
  });

  it("fails subset verification counts when either side is shorter than the source subset", () => {
    expect(
      evaluateVerificationCounts({
        subsetLimit: 10,
        sourceCount: 10,
        targetCount: 9,
        driftCount: 8
      })
    ).toEqual({
      targetCountMatches: false,
      driftCountMatches: false
    });
  });
});

describe("findMatchingWindowStart", () => {
  it("finds the start index of an ordered contiguous matching subsequence", () => {
    const source = [makeItem(3), makeItem(4)];
    const target = [makeItem(1), makeItem(2), makeItem(3), makeItem(4), makeItem(5)];

    expect(findMatchingWindowStart(source, target)).toBe(2);
  });

  it("returns null when the ordered subsequence is not present contiguously", () => {
    const source = [makeItem(2), makeItem(3)];
    const target = [makeItem(1), makeItem(2), makeItem(4), makeItem(3)];

    expect(findMatchingWindowStart(source, target)).toBeNull();
  });

  it("matches by normalized title when ids are unavailable", () => {
    const source = [makeItem(1, { videoId: null, videoUrl: null, title: "Same Title" })];
    const target = [
      makeItem(2, { videoId: null, videoUrl: null, title: "different" }),
      makeItem(3, { videoId: null, videoUrl: null, title: " same   title " })
    ];

    expect(findMatchingWindowStart(source, target)).toBe(1);
  });
});

describe("analyzeInventoryDiscrepancies", () => {
  it("returns no discrepancies for identical ordered inventories", () => {
    expect(analyzeInventoryDiscrepancies([makeItem(1), makeItem(2)], [makeItem(1), makeItem(2)])).toEqual({
      missingOccurrenceKeys: [],
      extraOccurrenceKeys: [],
      orderMismatchCount: 0,
      orderMismatches: []
    });
  });

  it("detects missing duplicate occurrences independently", () => {
    const source = [makeItem(1, { videoId: "dup" }), makeItem(2, { videoId: "dup" }), makeItem(3)];
    const target = [makeItem(1, { videoId: "dup" }), makeItem(3)];

    expect(analyzeInventoryDiscrepancies(source, target)).toEqual({
      missingOccurrenceKeys: ["dup#2"],
      extraOccurrenceKeys: [],
      orderMismatchCount: 2,
      orderMismatches: [
        {
          sourceIndex: 2,
          expectedOccurrenceKey: "dup#2",
          actualOccurrenceKey: "video-3#1"
        },
        {
          sourceIndex: 3,
          expectedOccurrenceKey: "video-3#1",
          actualOccurrenceKey: null
        }
      ]
    });
  });

  it("detects order mismatches without missing counts when the same items are reordered", () => {
    const source = [makeItem(1), makeItem(2), makeItem(3)];
    const target = [makeItem(1), makeItem(3), makeItem(2)];

    expect(analyzeInventoryDiscrepancies(source, target)).toEqual({
      missingOccurrenceKeys: [],
      extraOccurrenceKeys: [],
      orderMismatchCount: 2,
      orderMismatches: [
        {
          sourceIndex: 2,
          expectedOccurrenceKey: "video-2#1",
          actualOccurrenceKey: "video-3#1"
        },
        {
          sourceIndex: 3,
          expectedOccurrenceKey: "video-3#1",
          actualOccurrenceKey: "video-2#1"
        }
      ]
    });
  });
});

describe("discrepanciesAreClear", () => {
  it("returns true only when no discrepancy buckets are populated", () => {
    expect(
      discrepanciesAreClear({
        missingOccurrenceKeys: [],
        extraOccurrenceKeys: [],
        orderMismatchCount: 0,
        orderMismatches: []
      })
    ).toBe(true);

    expect(
      discrepanciesAreClear({
        missingOccurrenceKeys: ["video-1#1"],
        extraOccurrenceKeys: [],
        orderMismatchCount: 0,
        orderMismatches: []
      })
    ).toBe(false);
  });
});

// --- Verification Gate ---

describe("evaluateDeletionEligibility", () => {
  it("allows deletion only for a full clean verification", () => {
    expect(
      evaluateDeletionEligibility({
        passed: true,
        targetPassed: true,
        driftPassed: true,
        subsetLimit: null,
        sourceSnapshotMetadataComplete: true,
        sourceSnapshotBounded: false,
        expectedNonCopyableCount: 0,
        ambiguousSourceCount: 0,
        targetCountMatches: true,
        driftCountMatches: true,
        targetDiscrepanciesClear: true,
        driftDiscrepanciesClear: true,
        sourceSnapshotRunId: "snapshot-a"
      })
    ).toEqual({
      eligible: true,
      reasons: []
    });
  });

  it("blocks deletion for subset-only verification", () => {
    expect(
      evaluateDeletionEligibility({
        passed: true,
        targetPassed: true,
        driftPassed: true,
        subsetLimit: 10,
        sourceSnapshotMetadataComplete: true,
        sourceSnapshotBounded: false,
        expectedNonCopyableCount: 0,
        ambiguousSourceCount: 0,
        targetCountMatches: true,
        driftCountMatches: true,
        targetDiscrepanciesClear: true,
        driftDiscrepanciesClear: true,
        sourceSnapshotRunId: "snapshot-a"
      })
    ).toEqual({
      eligible: false,
      reasons: ["verification-was-subset-only"]
    });
  });

  it("accumulates multiple blocking reasons", () => {
    expect(
      evaluateDeletionEligibility({
        passed: false,
        targetPassed: false,
        driftPassed: false,
        subsetLimit: null,
        sourceSnapshotMetadataComplete: false,
        sourceSnapshotBounded: false,
        expectedNonCopyableCount: 1,
        ambiguousSourceCount: 2,
        targetCountMatches: false,
        driftCountMatches: false,
        targetDiscrepanciesClear: false,
        driftDiscrepanciesClear: false,
        sourceSnapshotRunId: null
      })
    ).toEqual({
      eligible: false,
      reasons: [
        "missing-source-snapshot",
        "source-snapshot-metadata-incomplete",
        "verification-did-not-pass",
        "target-verification-failed",
        "source-drift-verification-failed",
        "ambiguous-source-items-present",
        "expected-non-copyable-source-items-present",
        "target-count-mismatch",
        "source-drift-count-mismatch",
        "target-discrepancies-present",
        "source-drift-discrepancies-present"
      ]
    });
  });

  it("blocks deletion when expected non-copyable source items are present", () => {
    expect(
      evaluateDeletionEligibility({
        passed: true,
        targetPassed: true,
        driftPassed: true,
        subsetLimit: null,
        sourceSnapshotMetadataComplete: true,
        sourceSnapshotBounded: false,
        expectedNonCopyableCount: 1,
        ambiguousSourceCount: 0,
        targetCountMatches: true,
        driftCountMatches: true,
        targetDiscrepanciesClear: true,
        driftDiscrepanciesClear: true,
        sourceSnapshotRunId: "snapshot-a"
      })
    ).toEqual({
      eligible: false,
      reasons: ["expected-non-copyable-source-items-present"]
    });
  });

  it("blocks deletion when the source snapshot was bounded", () => {
    expect(
      evaluateDeletionEligibility({
        passed: true,
        targetPassed: true,
        driftPassed: true,
        subsetLimit: null,
        sourceSnapshotMetadataComplete: true,
        sourceSnapshotBounded: true,
        expectedNonCopyableCount: 0,
        ambiguousSourceCount: 0,
        targetCountMatches: true,
        driftCountMatches: true,
        targetDiscrepanciesClear: true,
        driftDiscrepanciesClear: true,
        sourceSnapshotRunId: "snapshot-a"
      })
    ).toEqual({
      eligible: false,
      reasons: ["source-snapshot-was-bounded"]
    });
  });

  it("blocks deletion when source snapshot metadata is incomplete", () => {
    expect(
      evaluateDeletionEligibility({
        passed: true,
        targetPassed: true,
        driftPassed: true,
        subsetLimit: null,
        sourceSnapshotMetadataComplete: false,
        sourceSnapshotBounded: false,
        expectedNonCopyableCount: 0,
        ambiguousSourceCount: 0,
        targetCountMatches: true,
        driftCountMatches: true,
        targetDiscrepanciesClear: true,
        driftDiscrepanciesClear: true,
        sourceSnapshotRunId: "snapshot-a"
      })
    ).toEqual({
      eligible: false,
      reasons: ["source-snapshot-metadata-incomplete"]
    });
  });
});

describe("buildProductionDeleteAuthorization", () => {
  it("records a full authorized verification explicitly", () => {
    expect(
      buildProductionDeleteAuthorization({
        verificationRunId: "verify-a",
        sourceSnapshotRunId: "snapshot-a",
        targetPlaylist: "Old Watch",
        subsetLimit: null,
        sourceSnapshotMetadataComplete: true,
        sourceSnapshotBounded: false,
        eligibility: {
          eligible: true,
          reasons: []
        },
        verifiedAt: "2026-03-21T00:00:00.000Z"
      })
    ).toEqual({
      authorized: true,
      reasons: [],
      verificationRunId: "verify-a",
      sourceSnapshotRunId: "snapshot-a",
      targetPlaylist: "Old Watch",
      verificationMode: "full",
      verifiedAt: "2026-03-21T00:00:00.000Z"
    });
  });

  it("records subset verification as non-authorizing context", () => {
    expect(
      buildProductionDeleteAuthorization({
        verificationRunId: "verify-b",
        sourceSnapshotRunId: "snapshot-b",
        targetPlaylist: "Old Watch",
        subsetLimit: 10,
        sourceSnapshotMetadataComplete: true,
        sourceSnapshotBounded: false,
        eligibility: {
          eligible: false,
          reasons: ["verification-was-subset-only"]
        },
        verifiedAt: "2026-03-21T00:00:00.000Z"
      })
    ).toEqual({
      authorized: false,
      reasons: ["verification-was-subset-only"],
      verificationRunId: "verify-b",
      sourceSnapshotRunId: "snapshot-b",
      targetPlaylist: "Old Watch",
      verificationMode: "subset",
      verifiedAt: "2026-03-21T00:00:00.000Z"
    });
  });

  it("records bounded snapshots as subset-mode authorization context", () => {
    expect(
      buildProductionDeleteAuthorization({
        verificationRunId: "verify-c",
        sourceSnapshotRunId: "snapshot-c",
        targetPlaylist: "Old Watch",
        subsetLimit: null,
        sourceSnapshotMetadataComplete: true,
        sourceSnapshotBounded: true,
        eligibility: {
          eligible: false,
          reasons: ["source-snapshot-was-bounded"]
        },
        verifiedAt: "2026-03-21T00:00:00.000Z"
      })
    ).toEqual({
      authorized: false,
      reasons: ["source-snapshot-was-bounded"],
      verificationRunId: "verify-c",
      sourceSnapshotRunId: "snapshot-c",
      targetPlaylist: "Old Watch",
      verificationMode: "subset",
      verifiedAt: "2026-03-21T00:00:00.000Z"
    });
  });

  it("records incomplete snapshot metadata as subset authorization context", () => {
    expect(
      buildProductionDeleteAuthorization({
        verificationRunId: "verify-d",
        sourceSnapshotRunId: "snapshot-d",
        targetPlaylist: "Old Watch",
        subsetLimit: null,
        sourceSnapshotMetadataComplete: false,
        sourceSnapshotBounded: false,
        eligibility: {
          eligible: false,
          reasons: ["source-snapshot-metadata-incomplete"]
        },
        verifiedAt: "2026-03-21T00:00:00.000Z"
      })
    ).toEqual({
      authorized: false,
      reasons: ["source-snapshot-metadata-incomplete"],
      verificationRunId: "verify-d",
      sourceSnapshotRunId: "snapshot-d",
      targetPlaylist: "Old Watch",
      verificationMode: "subset",
      verifiedAt: "2026-03-21T00:00:00.000Z"
    });
  });
});

// --- Verification Report ---

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verification-report-"));
  tempDirs.push(dir);
  return dir;
}

function writeReport(value: unknown): string {
  const dir = makeTempDir();
  const reportPath = path.join(dir, "verification.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`);
  return reportPath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("readVerificationReport", () => {
  it("accepts the current verification report shape", () => {
    const reportPath = writeReport({
      reportVersion: 1,
      reportComplete: true,
      sourceSnapshotRunId: "snapshot-a",
      sourceSnapshotPath: "/tmp/inventory.json",
      targetPlaylist: "Old Watch",
      passed: true,
      targetPassed: true,
      driftPassed: true,
      ambiguousSourceCount: 0,
      targetMismatches: [],
      productionDeleteAuthorization: {
        authorized: true,
        reasons: [],
        verificationRunId: "verify-a",
        sourceSnapshotRunId: "snapshot-a",
        targetPlaylist: "Old Watch",
        verificationMode: "full",
        verifiedAt: "2026-03-21T00:00:00.000Z"
      }
    });

    expect(readVerificationReport(reportPath).reportVersion).toBe(1);
  });

  it("fails closed on legacy reports without version metadata", () => {
    const reportPath = writeReport({
      sourceSnapshotRunId: "snapshot-a",
      sourceSnapshotPath: "/tmp/inventory.json",
      targetPlaylist: "Old Watch",
      passed: true,
      targetPassed: true,
      driftPassed: true,
      ambiguousSourceCount: 0,
      targetMismatches: [],
      productionDeleteAuthorization: {
        authorized: false,
        reasons: ["verification-was-subset-only"],
        verificationRunId: "verify-a",
        sourceSnapshotRunId: "snapshot-a",
        targetPlaylist: "Old Watch",
        verificationMode: "subset",
        verifiedAt: "2026-03-21T00:00:00.000Z"
      }
    });

    expect(() => readVerificationReport(reportPath)).toThrow(/unsupported or incomplete/i);
  });

  it("fails closed when authorization metadata is missing", () => {
    const reportPath = writeReport({
      reportVersion: 1,
      reportComplete: true,
      sourceSnapshotRunId: "snapshot-a",
      sourceSnapshotPath: "/tmp/inventory.json",
      targetPlaylist: "Old Watch",
      passed: true,
      targetPassed: true,
      driftPassed: true,
      ambiguousSourceCount: 0,
      targetMismatches: []
    });

    expect(() => readVerificationReport(reportPath)).toThrow(/missing production delete authorization/i);
  });
});
