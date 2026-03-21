import type { CheckpointRecord, InventoryItem } from "../models/types.js";

export interface CopyResumePlan {
  resumed: boolean;
  processedCount: number;
  remainingItems: InventoryItem[];
  savedCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface RepairResumePlan {
  resumed: boolean;
  processedCount: number;
  remainingItems: InventoryItem[];
  repairedCount: number;
  skippedCount: number;
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
      remainingItems: sourceItems,
      savedCount: 0,
      skippedCount: 0,
      failedCount: 0
    };
  }

  if (checkpoint.phase !== "copy") {
    throw new Error(`Cannot resume copy from checkpoint phase '${checkpoint.phase}'`);
  }

  const checkpointSnapshotRunId = readStringField(checkpoint.payload, "sourceSnapshotRunId");
  const checkpointTargetPlaylist = readStringField(checkpoint.payload, "targetPlaylist");
  const processed = readNumberField(checkpoint.payload, "processed");
  const savedCount = readNumberField(checkpoint.payload, "savedCount");
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
    processedCount: processed,
    remainingItems: sourceItems.filter((item) => item.sourceIndex > processed),
    savedCount,
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
    skippedCount,
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

function readNumberField(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Checkpoint payload is missing numeric field '${key}'`);
  }

  return value;
}
