import { describe, expect, it } from "vitest";

import type { CheckpointRecord, InventoryItem } from "../models/types.js";
import { sliceIntoChunks, planChunkedMoveResume } from "./chunkPlanner.js";

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

function makeCheckpoint(payload: Record<string, unknown>): CheckpointRecord {
  return {
    phase: "chunked-move",
    updatedAt: "2026-03-31T00:00:00.000Z",
    payload
  };
}

describe("sliceIntoChunks", () => {
  it("slices items into equal chunks", () => {
    const items = [makeItem(1), makeItem(2), makeItem(3), makeItem(4)];
    const chunks = sliceIntoChunks(items, 2);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual([makeItem(1), makeItem(2)]);
    expect(chunks[1]).toEqual([makeItem(3), makeItem(4)]);
  });

  it("handles a final partial chunk", () => {
    const items = [makeItem(1), makeItem(2), makeItem(3)];
    const chunks = sliceIntoChunks(items, 2);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(2);
    expect(chunks[1]).toHaveLength(1);
    expect(chunks[1]![0]!.sourceIndex).toBe(3);
  });

  it("returns a single chunk when items fit", () => {
    const items = [makeItem(1), makeItem(2)];
    const chunks = sliceIntoChunks(items, 5);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(items);
  });

  it("returns empty array for empty input", () => {
    expect(sliceIntoChunks([], 10)).toEqual([]);
  });

  it("throws for chunk size less than 1", () => {
    expect(() => sliceIntoChunks([makeItem(1)], 0)).toThrow("Chunk size must be at least 1");
  });
});

describe("planChunkedMoveResume", () => {
  const chunks = [
    [makeItem(1), makeItem(2)],
    [makeItem(3), makeItem(4)],
    [makeItem(5), makeItem(6)]
  ];

  it("returns fresh plan when no checkpoint exists", () => {
    const plan = planChunkedMoveResume({
      checkpoint: null,
      chunks,
      sourceSnapshotRunId: "snapshot-a",
      targetPlaylist: "Old Watch"
    });

    expect(plan.resumed).toBe(false);
    expect(plan.completedChunks).toBe(0);
    expect(plan.currentChunkIndex).toBe(0);
    expect(plan.currentChunkPhase).toBe("copy");
    expect(plan.savedCount).toBe(0);
    expect(plan.removedCount).toBe(0);
  });

  it("resumes at the correct chunk and phase", () => {
    const plan = planChunkedMoveResume({
      checkpoint: makeCheckpoint({
        sourceSnapshotRunId: "snapshot-a",
        targetPlaylist: "Old Watch",
        completedChunks: 1,
        currentChunkIndex: 1,
        currentChunkPhase: "delete",
        currentChunkCopyProcessed: 2,
        currentChunkDeleteProcessed: 1,
        savedCount: 2,
        alreadySavedCount: 0,
        expectedNonCopyableCount: 0,
        ambiguousBlockedCount: 0,
        removedCount: 2,
        retryExhaustedCount: 0,
        skippedCount: 0,
        failedCount: 0
      }),
      chunks,
      sourceSnapshotRunId: "snapshot-a",
      targetPlaylist: "Old Watch"
    });

    expect(plan.resumed).toBe(true);
    expect(plan.completedChunks).toBe(1);
    expect(plan.currentChunkIndex).toBe(1);
    expect(plan.currentChunkPhase).toBe("delete");
    expect(plan.currentChunkDeleteProcessed).toBe(1);
    expect(plan.savedCount).toBe(2);
    expect(plan.removedCount).toBe(2);
  });

  it("advances past a completed chunk", () => {
    const plan = planChunkedMoveResume({
      checkpoint: makeCheckpoint({
        sourceSnapshotRunId: "snapshot-a",
        targetPlaylist: "Old Watch",
        completedChunks: 1,
        currentChunkIndex: 1,
        currentChunkPhase: "complete",
        currentChunkCopyProcessed: 2,
        currentChunkDeleteProcessed: 2,
        savedCount: 4,
        alreadySavedCount: 0,
        expectedNonCopyableCount: 0,
        ambiguousBlockedCount: 0,
        removedCount: 4,
        retryExhaustedCount: 0,
        skippedCount: 0,
        failedCount: 0
      }),
      chunks,
      sourceSnapshotRunId: "snapshot-a",
      targetPlaylist: "Old Watch"
    });

    expect(plan.resumed).toBe(true);
    expect(plan.completedChunks).toBe(2);
    expect(plan.currentChunkIndex).toBe(2);
    expect(plan.currentChunkPhase).toBe("copy");
    expect(plan.currentChunkCopyProcessed).toBe(0);
    expect(plan.currentChunkDeleteProcessed).toBe(0);
  });

  it("throws on snapshot mismatch", () => {
    expect(() =>
      planChunkedMoveResume({
        checkpoint: makeCheckpoint({
          sourceSnapshotRunId: "snapshot-WRONG",
          targetPlaylist: "Old Watch",
          completedChunks: 0,
          currentChunkIndex: 0,
          currentChunkPhase: "copy",
          currentChunkCopyProcessed: 0,
          currentChunkDeleteProcessed: 0,
          savedCount: 0,
          alreadySavedCount: 0,
          expectedNonCopyableCount: 0,
          ambiguousBlockedCount: 0,
          removedCount: 0,
          retryExhaustedCount: 0,
          skippedCount: 0,
          failedCount: 0
        }),
        chunks,
        sourceSnapshotRunId: "snapshot-a",
        targetPlaylist: "Old Watch"
      })
    ).toThrow("does not match");
  });

  it("throws on target playlist mismatch", () => {
    expect(() =>
      planChunkedMoveResume({
        checkpoint: makeCheckpoint({
          sourceSnapshotRunId: "snapshot-a",
          targetPlaylist: "Wrong Playlist",
          completedChunks: 0,
          currentChunkIndex: 0,
          currentChunkPhase: "copy",
          currentChunkCopyProcessed: 0,
          currentChunkDeleteProcessed: 0,
          savedCount: 0,
          alreadySavedCount: 0,
          expectedNonCopyableCount: 0,
          ambiguousBlockedCount: 0,
          removedCount: 0,
          retryExhaustedCount: 0,
          skippedCount: 0,
          failedCount: 0
        }),
        chunks,
        sourceSnapshotRunId: "snapshot-a",
        targetPlaylist: "Old Watch"
      })
    ).toThrow("does not match");
  });

  it("throws on wrong checkpoint phase", () => {
    expect(() =>
      planChunkedMoveResume({
        checkpoint: { phase: "copy", updatedAt: "2026-03-31T00:00:00.000Z", payload: {} },
        chunks,
        sourceSnapshotRunId: "snapshot-a",
        targetPlaylist: "Old Watch"
      })
    ).toThrow("Cannot resume chunked-move from checkpoint phase");
  });
});
