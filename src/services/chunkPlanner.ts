import type { CheckpointRecord, InventoryItem } from "../models/types.js";

export type ChunkedMoveChunkPhase = "copy" | "verify" | "delete" | "complete";

export interface ChunkedMoveResumePlan {
  resumed: boolean;
  completedChunks: number;
  currentChunkIndex: number;
  currentChunkPhase: ChunkedMoveChunkPhase;
  currentChunkCopyProcessed: number;
  currentChunkDeleteProcessed: number;
  savedCount: number;
  alreadySavedCount: number;
  expectedNonCopyableCount: number;
  ambiguousBlockedCount: number;
  removedCount: number;
  retryExhaustedCount: number;
  skippedCount: number;
  failedCount: number;
}

export function sliceIntoChunks(items: InventoryItem[], chunkSize: number): InventoryItem[][] {
  if (chunkSize < 1) {
    throw new Error(`Chunk size must be at least 1, got ${chunkSize}`);
  }

  const chunks: InventoryItem[][] = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  return chunks;
}

export function planChunkedMoveResume(args: {
  checkpoint: CheckpointRecord | null;
  chunks: InventoryItem[][];
  sourceSnapshotRunId: string;
  targetPlaylist: string;
}): ChunkedMoveResumePlan {
  const { checkpoint, chunks, sourceSnapshotRunId, targetPlaylist } = args;

  if (!checkpoint) {
    return {
      resumed: false,
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
    };
  }

  if (checkpoint.phase !== "chunked-move") {
    throw new Error(`Cannot resume chunked-move from checkpoint phase '${checkpoint.phase}'`);
  }

  const checkpointSnapshotRunId = readStringField(checkpoint.payload, "sourceSnapshotRunId");
  const checkpointTargetPlaylist = readStringField(checkpoint.payload, "targetPlaylist");

  if (checkpointSnapshotRunId !== sourceSnapshotRunId) {
    throw new Error(
      `Checkpoint snapshot run '${checkpointSnapshotRunId}' does not match requested source snapshot '${sourceSnapshotRunId}'`
    );
  }

  if (checkpointTargetPlaylist !== targetPlaylist) {
    throw new Error(
      `Checkpoint target playlist '${checkpointTargetPlaylist}' does not match requested target playlist '${targetPlaylist}'`
    );
  }

  const completedChunks = readNumberField(checkpoint.payload, "completedChunks");
  const currentChunkIndex = readNumberField(checkpoint.payload, "currentChunkIndex");
  const currentChunkPhase = readStringField(checkpoint.payload, "currentChunkPhase") as ChunkedMoveChunkPhase;
  const currentChunkCopyProcessed = readNumberField(checkpoint.payload, "currentChunkCopyProcessed");
  const currentChunkDeleteProcessed = readNumberField(checkpoint.payload, "currentChunkDeleteProcessed");

  // If the current chunk was fully completed, advance to the next one
  const effectiveChunkIndex = currentChunkPhase === "complete" ? currentChunkIndex + 1 : currentChunkIndex;
  const effectiveChunkPhase = currentChunkPhase === "complete" ? "copy" as const : currentChunkPhase;
  const effectiveCopyProcessed = currentChunkPhase === "complete" ? 0 : currentChunkCopyProcessed;
  const effectiveDeleteProcessed = currentChunkPhase === "complete" ? 0 : currentChunkDeleteProcessed;
  const effectiveCompleted = currentChunkPhase === "complete" ? completedChunks + 1 : completedChunks;

  if (effectiveChunkIndex >= chunks.length) {
    return {
      resumed: true,
      completedChunks: chunks.length,
      currentChunkIndex: chunks.length,
      currentChunkPhase: "complete",
      currentChunkCopyProcessed: 0,
      currentChunkDeleteProcessed: 0,
      savedCount: readNumberField(checkpoint.payload, "savedCount"),
      alreadySavedCount: readNumberField(checkpoint.payload, "alreadySavedCount"),
      expectedNonCopyableCount: readNumberField(checkpoint.payload, "expectedNonCopyableCount"),
      ambiguousBlockedCount: readNumberField(checkpoint.payload, "ambiguousBlockedCount"),
      removedCount: readNumberField(checkpoint.payload, "removedCount"),
      retryExhaustedCount: readNumberField(checkpoint.payload, "retryExhaustedCount"),
      skippedCount: readNumberField(checkpoint.payload, "skippedCount"),
      failedCount: readNumberField(checkpoint.payload, "failedCount")
    };
  }

  return {
    resumed: true,
    completedChunks: effectiveCompleted,
    currentChunkIndex: effectiveChunkIndex,
    currentChunkPhase: effectiveChunkPhase,
    currentChunkCopyProcessed: effectiveCopyProcessed,
    currentChunkDeleteProcessed: effectiveDeleteProcessed,
    savedCount: readNumberField(checkpoint.payload, "savedCount"),
    alreadySavedCount: readNumberField(checkpoint.payload, "alreadySavedCount"),
    expectedNonCopyableCount: readNumberField(checkpoint.payload, "expectedNonCopyableCount"),
    ambiguousBlockedCount: readNumberField(checkpoint.payload, "ambiguousBlockedCount"),
    removedCount: readNumberField(checkpoint.payload, "removedCount"),
    retryExhaustedCount: readNumberField(checkpoint.payload, "retryExhaustedCount"),
    skippedCount: readNumberField(checkpoint.payload, "skippedCount"),
    failedCount: readNumberField(checkpoint.payload, "failedCount")
  };
}

function readStringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Checkpoint payload is missing string field '${key}'`);
  }
  return value;
}

function readNumberField(payload: Record<string, unknown>, key: string, fallback?: number): number {
  const value = payload[key];
  if (typeof value === "undefined" && typeof fallback === "number") {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Checkpoint payload is missing numeric field '${key}'`);
  }
  return value;
}
