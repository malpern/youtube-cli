import { describe, expect, it } from "vitest";

import { buildPlaylistMetadataIndex, resolvePlaylistMetadata } from "./playlistMetadata.js";

describe("playlistMetadata", () => {
  it("prefers an exact title and visibility match", () => {
    const index = buildPlaylistMetadataIndex([
      { playlistId: "pl-public", title: "Old Watch", visibility: "Public", videoCount: 10 },
      { playlistId: "pl-private", title: "Old Watch", visibility: "Private", videoCount: 12 }
    ]);

    expect(resolvePlaylistMetadata(index, "Old Watch", "Private")).toEqual({
      playlistId: "pl-private",
      videoCount: 12
    });
  });

  it("falls back to title only when that title is unique in the feed", () => {
    const index = buildPlaylistMetadataIndex([
      { playlistId: "pl-1", title: "Old Watch", visibility: "Private", videoCount: 12 },
      { playlistId: "pl-2", title: "Programming", visibility: "Public", videoCount: 5 }
    ]);

    expect(resolvePlaylistMetadata(index, "Programming", null)).toEqual({
      playlistId: "pl-2",
      videoCount: 5
    });
  });

  it("does not guess by title when the feed contains duplicate titles", () => {
    const index = buildPlaylistMetadataIndex([
      { playlistId: "pl-public", title: "Old Watch", visibility: "Public", videoCount: 10 },
      { playlistId: "pl-private", title: "Old Watch", visibility: "Private", videoCount: 12 }
    ]);

    expect(resolvePlaylistMetadata(index, "Old Watch", null)).toBeNull();
  });
});
