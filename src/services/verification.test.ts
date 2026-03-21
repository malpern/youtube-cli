import { describe, expect, it } from "vitest";

import type { InventoryItem } from "../models/types.js";
import { analyzeInventoryDiscrepancies, compareOrderedPrefix, discrepanciesAreClear, evaluateVerificationCounts, findMatchingWindowStart } from "./verification.js";

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
