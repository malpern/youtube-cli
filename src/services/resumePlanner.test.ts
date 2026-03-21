import { describe, expect, it } from "vitest";

import type { CheckpointRecord, InventoryItem } from "../models/types.js";
import { planCopyResume, planRepairResume } from "./resumePlanner.js";

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

function makeCopyCheckpoint(payload: Record<string, unknown>): CheckpointRecord {
  return {
    phase: "copy",
    updatedAt: "2026-03-21T00:00:00.000Z",
    payload
  };
}

function makeRepairCheckpoint(payload: Record<string, unknown>): CheckpointRecord {
  return {
    phase: "repair",
    updatedAt: "2026-03-21T00:00:00.000Z",
    payload
  };
}

describe("planCopyResume", () => {
  it("returns the full item list when no checkpoint exists", () => {
    const plan = planCopyResume({
      checkpoint: null,
      sourceItems: [makeItem(1), makeItem(2)],
      sourceSnapshotRunId: "snapshot-a",
      targetPlaylist: "Old Watch"
    });

    expect(plan).toEqual({
      resumed: false,
      processedCount: 0,
      remainingItems: [makeItem(1), makeItem(2)],
      savedCount: 0,
      skippedCount: 0,
      failedCount: 0
    });
  });

  it("filters out already processed items when checkpoint metadata matches", () => {
    const plan = planCopyResume({
      checkpoint: makeCopyCheckpoint({
        sourceSnapshotRunId: "snapshot-a",
        targetPlaylist: "Old Watch",
        processed: 2,
        savedCount: 1,
        skippedCount: 1,
        failedCount: 0
      }),
      sourceItems: [makeItem(1), makeItem(2), makeItem(3), makeItem(4)],
      sourceSnapshotRunId: "snapshot-a",
      targetPlaylist: "Old Watch"
    });

    expect(plan).toEqual({
      resumed: true,
      processedCount: 2,
      remainingItems: [makeItem(3), makeItem(4)],
      savedCount: 1,
      skippedCount: 1,
      failedCount: 0
    });
  });

  it("throws when the checkpoint phase is not copy", () => {
    expect(() =>
      planCopyResume({
        checkpoint: {
          phase: "verify",
          updatedAt: "2026-03-21T00:00:00.000Z",
          payload: {}
        },
        sourceItems: [makeItem(1)],
        sourceSnapshotRunId: "snapshot-a",
        targetPlaylist: "Old Watch"
      })
    ).toThrow(/Cannot resume copy/);
  });

  it("throws when the checkpoint snapshot does not match", () => {
    expect(() =>
      planCopyResume({
        checkpoint: makeCopyCheckpoint({
          sourceSnapshotRunId: "snapshot-b",
          targetPlaylist: "Old Watch",
          processed: 1,
          savedCount: 1,
          skippedCount: 0,
          failedCount: 0
        }),
        sourceItems: [makeItem(1)],
        sourceSnapshotRunId: "snapshot-a",
        targetPlaylist: "Old Watch"
      })
    ).toThrow(/does not match requested source snapshot/);
  });

  it("throws when the checkpoint target playlist does not match", () => {
    expect(() =>
      planCopyResume({
        checkpoint: makeCopyCheckpoint({
          sourceSnapshotRunId: "snapshot-a",
          targetPlaylist: "Different Playlist",
          processed: 1,
          savedCount: 1,
          skippedCount: 0,
          failedCount: 0
        }),
        sourceItems: [makeItem(1)],
        sourceSnapshotRunId: "snapshot-a",
        targetPlaylist: "Old Watch"
      })
    ).toThrow(/does not match requested target playlist/);
  });
});

describe("planRepairResume", () => {
  it("returns the full repair candidate list when no checkpoint exists", () => {
    const plan = planRepairResume({
      checkpoint: null,
      repairItems: [makeItem(10), makeItem(20)],
      sourceSnapshotRunId: "snapshot-a",
      targetPlaylist: "Old Watch",
      verificationPath: "/tmp/verification.json"
    });

    expect(plan).toEqual({
      resumed: false,
      processedCount: 0,
      remainingItems: [makeItem(10), makeItem(20)],
      repairedCount: 0,
      skippedCount: 0,
      failedCount: 0
    });
  });

  it("skips already processed repair candidates when checkpoint metadata matches", () => {
    const plan = planRepairResume({
      checkpoint: makeRepairCheckpoint({
        verificationPath: "/tmp/verification.json",
        sourceSnapshotRunId: "snapshot-a",
        targetPlaylist: "Old Watch",
        processed: 1,
        repairedCount: 1,
        skippedCount: 0,
        failedCount: 0
      }),
      repairItems: [makeItem(10), makeItem(20), makeItem(30)],
      sourceSnapshotRunId: "snapshot-a",
      targetPlaylist: "Old Watch",
      verificationPath: "/tmp/verification.json"
    });

    expect(plan).toEqual({
      resumed: true,
      processedCount: 1,
      remainingItems: [makeItem(20), makeItem(30)],
      repairedCount: 1,
      skippedCount: 0,
      failedCount: 0
    });
  });

  it("throws when the verification path does not match", () => {
    expect(() =>
      planRepairResume({
        checkpoint: makeRepairCheckpoint({
          verificationPath: "/tmp/other-verification.json",
          sourceSnapshotRunId: "snapshot-a",
          targetPlaylist: "Old Watch",
          processed: 0,
          repairedCount: 0,
          skippedCount: 0,
          failedCount: 0
        }),
        repairItems: [makeItem(10)],
        sourceSnapshotRunId: "snapshot-a",
        targetPlaylist: "Old Watch",
        verificationPath: "/tmp/verification.json"
      })
    ).toThrow(/does not match requested verification path/);
  });
});
