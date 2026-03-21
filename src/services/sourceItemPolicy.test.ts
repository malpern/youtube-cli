import { describe, expect, it } from "vitest";

import type { InventoryItem } from "../models/types.js";
import { ambiguousSourceItemMismatches, assessSourceItemPolicy, partitionSourceItems } from "./sourceItemPolicy.js";

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

describe("assessSourceItemPolicy", () => {
  it("marks normal rows as copyable", () => {
    expect(assessSourceItemPolicy(makeItem(1))).toEqual({
      policy: "copyable",
      reason: "has-copyable-video-url"
    });
  });

  it("marks private/deleted/unavailable rows as expected non-copyable", () => {
    expect(assessSourceItemPolicy(makeItem(1, { unavailableKind: "private", videoUrl: null, videoId: null }))).toEqual({
      policy: "expected-non-copyable",
      reason: "private"
    });

    expect(assessSourceItemPolicy(makeItem(2, { unavailableKind: "deleted", videoUrl: null, videoId: null }))).toEqual({
      policy: "expected-non-copyable",
      reason: "deleted"
    });
  });

  it("marks unknown or missing-url rows as ambiguous", () => {
    expect(assessSourceItemPolicy(makeItem(1, { unavailableKind: "unknown", videoUrl: null, videoId: null }))).toEqual({
      policy: "ambiguous-unavailable",
      reason: "unknown-unavailable-state"
    });

    expect(assessSourceItemPolicy(makeItem(2, { unavailableKind: "none", videoUrl: null }))).toEqual({
      policy: "ambiguous-unavailable",
      reason: "missing-video-url"
    });
  });
});

describe("partitionSourceItems", () => {
  it("splits source items by policy", () => {
    const partitioned = partitionSourceItems([
      makeItem(1),
      makeItem(2, { unavailableKind: "private", videoUrl: null, videoId: null }),
      makeItem(3, { unavailableKind: "unknown", videoUrl: null, videoId: null })
    ]);

    expect(partitioned.copyableItems.map((item) => item.sourceIndex)).toEqual([1]);
    expect(partitioned.expectedNonCopyableItems.map((item) => item.sourceIndex)).toEqual([2]);
    expect(partitioned.ambiguousItems.map((item) => item.sourceIndex)).toEqual([3]);
  });
});

describe("ambiguousSourceItemMismatches", () => {
  it("turns ambiguous items into verification mismatches", () => {
    expect(
      ambiguousSourceItemMismatches([
        makeItem(7, { title: null, videoId: null, videoUrl: null, unavailableKind: "unknown" })
      ])
    ).toEqual([
      {
        sourceIndex: 7,
        field: "ambiguous-source-item",
        expected: "unknown",
        actual: null
      }
    ]);
  });
});
