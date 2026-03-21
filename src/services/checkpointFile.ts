import fs from "node:fs";

import type { CheckpointRecord, Phase } from "../models/types.js";
import { isoNow } from "../utils/time.js";

export function writeCheckpointFile(
  checkpointPath: string,
  phase: Phase,
  payload: Record<string, unknown>
): void {
  fs.writeFileSync(
    checkpointPath,
    `${JSON.stringify(
      {
        phase,
        updatedAt: isoNow(),
        ...payload
      },
      null,
      2
    )}\n`
  );
}

export function readCheckpointFile(checkpointPath: string): CheckpointRecord | null {
  if (!fs.existsSync(checkpointPath)) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as Record<string, unknown>;
  const phase = parsed.phase;
  const updatedAt = parsed.updatedAt;

  if (typeof phase !== "string" || typeof updatedAt !== "string") {
    throw new Error(`Checkpoint file '${checkpointPath}' is missing required fields`);
  }

  const { phase: _phase, updatedAt: _updatedAt, ...payload } = parsed;

  return {
    phase: phase as Phase,
    updatedAt,
    payload
  };
}

export function canResumeFromCheckpoint(
  checkpoint: CheckpointRecord | null,
  expectedPhase: Phase,
  requiredFields: string[] = []
): boolean {
  if (!checkpoint || checkpoint.phase !== expectedPhase) {
    return false;
  }

  return requiredFields.every((field) => Object.prototype.hasOwnProperty.call(checkpoint.payload, field));
}
