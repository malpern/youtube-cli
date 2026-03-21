import { describe, expect, it } from "vitest";

import type { InventoryItem } from "../models/types.js";
import { selectSourceItems } from "./sourceSelection.js";

function makeItem(sourceIndex: number): InventoryItem {
  return {
    sourceIndex,
    title: `Video ${sourceIndex}`,
    videoUrl: `https://www.youtube.com/watch?v=video-${sourceIndex}`,
    videoId: `video-${sourceIndex}`,
    channelName: "Channel",
    metadataText: null,
    unavailableKind: "none"
  };
}

describe("selectSourceItems", () => {
  it("returns all items from the start index onward", () => {
    expect(selectSourceItems([makeItem(1), makeItem(2), makeItem(3)], { startIndex: 2 })).toEqual([makeItem(2), makeItem(3)]);
  });

  it("applies max-items after start-index filtering", () => {
    expect(selectSourceItems([makeItem(1), makeItem(2), makeItem(3), makeItem(4)], { startIndex: 2, maxItems: 2 })).toEqual([
      makeItem(2),
      makeItem(3)
    ]);
  });

  it("defaults to the full item list when no bounds are provided", () => {
    expect(selectSourceItems([makeItem(1), makeItem(2)], {})).toEqual([makeItem(1), makeItem(2)]);
  });
});
