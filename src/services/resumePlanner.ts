import type { CheckpointRecord, InventoryItem } from "../models/types.js";

export interface CopyResumePlan {
  resumed: boolean;
  processedCount: number;
  lastProcessedSourceIndex: number;
  remainingItems: InventoryItem[];
  savedCount: number;
  alreadySavedCount: number;
  expectedNonCopyableCount: number;
  ambiguousBlockedCount: number;
  retryExhaustedCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface RepairResumePlan {
  resumed: boolean;
  processedCount: number;
  remainingItems: InventoryItem[];
  repairedCount: number;
  savedCount: number;
  alreadySavedCount: number;
  policySkippedCount: number;
  retryExhaustedCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface DeleteResumePlan {
  resumed: boolean;
  processedCount: number;
  remainingItems: InventoryItem[];
  removedCount: number;
  retryExhaustedCount: number;
  failedCount: number;
}

export function planCopyResume(args: {
  checkpoint: CheckpointRecord | null;
  sourceItems: InventoryItem[];
  sourceSnapshotRunId: string;
  targetPlaylist: string;
}): CopyResumePlan {
  const { checkpoint, sourceItems, sourceSnapshotRunId, targetPlaylist } = args;

  if (!checkpoint) {
    return {
      resumed: false,
      processedCount: 0,
      lastProcessedSourceIndex: 0,
      remainingItems: sourceItems,
      savedCount: 0,
      alreadySavedCount: 0,
      expectedNonCopyableCount: 0,
      ambiguousBlockedCount: 0,
      retryExhaustedCount: 0,
      skippedCount: 0,
      failedCount: 0
    };
  }

  if (checkpoint.phase !== "copy") {
    throw new Error(`Cannot resume copy from checkpoint phase '${checkpoint.phase}'`);
  }

  const checkpointSnapshotRunId = readStringField(checkpoint.payload, "sourceSnapshotRunId");
  const checkpointTargetPlaylist = readStringField(checkpoint.payload, "targetPlaylist");
  const legacyProcessed = readOptionalNumberField(checkpoint.payload, "processed");
  const processedCount = readNumberField(checkpoint.payload, "processedCount", legacyProcessed ?? undefined);
  const lastProcessedSourceIndex = readNumberField(checkpoint.payload, "lastProcessedSourceIndex", legacyProcessed ?? undefined);
  const savedCount = readNumberField(checkpoint.payload, "savedCount");
  const alreadySavedCount = readNumberField(checkpoint.payload, "alreadySavedCount", 0);
  const expectedNonCopyableCount = readNumberField(checkpoint.payload, "expectedNonCopyableCount", 0);
  const ambiguousBlockedCount = readNumberField(checkpoint.payload, "ambiguousBlockedCount", 0);
  const retryExhaustedCount = readNumberField(checkpoint.payload, "retryExhaustedCount", 0);
  const skippedCount = readNumberField(checkpoint.payload, "skippedCount");
  const failedCount = readNumberField(checkpoint.payload, "failedCount");

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

  return {
    resumed: true,
    processedCount,
    lastProcessedSourceIndex,
    remainingItems: sourceItems.filter((item) => item.sourceIndex > lastProcessedSourceIndex),
    savedCount,
    alreadySavedCount,
    expectedNonCopyableCount,
    ambiguousBlockedCount,
    retryExhaustedCount,
    skippedCount,
    failedCount
  };
}

export function planRepairResume(args: {
  checkpoint: CheckpointRecord | null;
  repairItems: InventoryItem[];
  sourceSnapshotRunId: string;
  targetPlaylist: string;
  verificationPath: string;
}): RepairResumePlan {
  const { checkpoint, repairItems, sourceSnapshotRunId, targetPlaylist, verificationPath } = args;

  if (!checkpoint) {
    return {
      resumed: false,
      processedCount: 0,
      remainingItems: repairItems,
      repairedCount: 0,
      savedCount: 0,
      alreadySavedCount: 0,
      policySkippedCount: 0,
      retryExhaustedCount: 0,
      skippedCount: 0,
      failedCount: 0
    };
  }

  if (checkpoint.phase !== "repair") {
    throw new Error(`Cannot resume repair from checkpoint phase '${checkpoint.phase}'`);
  }

  const checkpointVerificationPath = readStringField(checkpoint.payload, "verificationPath");
  const checkpointSnapshotRunId = readStringField(checkpoint.payload, "sourceSnapshotRunId");
  const checkpointTargetPlaylist = readStringField(checkpoint.payload, "targetPlaylist");
  const processed = readNumberField(checkpoint.payload, "processed");
  const repairedCount = readNumberField(checkpoint.payload, "repairedCount");
  const savedCount = readNumberField(checkpoint.payload, "savedCount", 0);
  const alreadySavedCount = readNumberField(checkpoint.payload, "alreadySavedCount", 0);
  const policySkippedCount = readNumberField(checkpoint.payload, "policySkippedCount", 0);
  const retryExhaustedCount = readNumberField(checkpoint.payload, "retryExhaustedCount", 0);
  const skippedCount = readNumberField(checkpoint.payload, "skippedCount");
  const failedCount = readNumberField(checkpoint.payload, "failedCount");

  if (checkpointVerificationPath !== verificationPath) {
    throw new Error(
      `Checkpoint verification path '${checkpointVerificationPath}' does not match requested verification path '${verificationPath}'`
    );
  }

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

  return {
    resumed: true,
    processedCount: processed,
    remainingItems: repairItems.slice(processed),
    repairedCount,
    savedCount,
    alreadySavedCount,
    policySkippedCount,
    retryExhaustedCount,
    skippedCount,
    failedCount
  };
}

export function planDeleteResume(args: {
  checkpoint: CheckpointRecord | null;
  deleteItems: InventoryItem[];
  sourceSnapshotRunId: string;
  verificationPath: string;
}): DeleteResumePlan {
  const { checkpoint, deleteItems, sourceSnapshotRunId, verificationPath } = args;

  if (!checkpoint) {
    return {
      resumed: false,
      processedCount: 0,
      remainingItems: deleteItems,
      removedCount: 0,
      retryExhaustedCount: 0,
      failedCount: 0
    };
  }

  if (checkpoint.phase !== "delete") {
    throw new Error(`Cannot resume delete from checkpoint phase '${checkpoint.phase}'`);
  }

  const checkpointVerificationPath = readStringField(checkpoint.payload, "verificationPath");
  const checkpointSnapshotRunId = readStringField(checkpoint.payload, "sourceSnapshotRunId");
  const processed = readNumberField(checkpoint.payload, "processed");
  const removedCount = readNumberField(checkpoint.payload, "removedCount");
  const retryExhaustedCount = readNumberField(checkpoint.payload, "retryExhaustedCount", 0);
  const failedCount = readNumberField(checkpoint.payload, "failedCount");

  if (checkpointVerificationPath !== verificationPath) {
    throw new Error(
      `Checkpoint verification path '${checkpointVerificationPath}' does not match requested verification path '${verificationPath}'`
    );
  }

  if (checkpointSnapshotRunId !== sourceSnapshotRunId) {
    throw new Error(
      `Checkpoint snapshot run '${checkpointSnapshotRunId}' does not match requested source snapshot '${sourceSnapshotRunId}'`
    );
  }

  return {
    resumed: true,
    processedCount: processed,
    remainingItems: deleteItems.slice(processed),
    removedCount,
    retryExhaustedCount,
    failedCount
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

function readOptionalNumberField(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  if (typeof value === "undefined") {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Checkpoint payload is missing numeric field '${key}'`);
  }

  return value;
}
