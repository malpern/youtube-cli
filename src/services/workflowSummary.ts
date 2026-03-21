import fs from "node:fs";
import path from "node:path";

import type { CheckpointRecord, InventoryFingerprint } from "../models/types.js";
import { readCheckpointFile } from "./checkpointFile.js";
import { readVerificationReport } from "./verificationReport.js";

interface InventoryArtifact {
  capturedAt?: string;
  total?: number;
  scrollPasses?: number;
  requestedMaxItems?: number | null;
  bounded?: boolean;
  fingerprint?: InventoryFingerprint;
}

interface SetupArtifact {
  outcome?: string;
  firstVideoUrl?: string;
}

export interface WorkflowChildSummaries {
  setup: {
    runId: string;
    outcome: string | null;
    firstVideoUrl: string | null;
  } | null;
  inventory: {
    runId: string;
    total: number | null;
    scrollPasses: number | null;
    requestedMaxItems: number | null;
    bounded: boolean | null;
    fingerprint: InventoryFingerprint | null;
  } | null;
  copy: {
    runId: string;
    processed: number | null;
    total: number | null;
    savedCount: number | null;
    alreadySavedCount: number | null;
    expectedNonCopyableCount: number | null;
    ambiguousBlockedCount: number | null;
    retryExhaustedCount: number | null;
    skippedCount: number | null;
    failedCount: number | null;
  } | null;
  verify: {
    runId: string;
    passed: boolean | null;
    targetPassed: boolean | null;
    driftPassed: boolean | null;
    verificationMode: "full" | "subset" | null;
    deletionEligible: boolean | null;
    deletionBlockedBy: string[] | null;
    authorizationVerificationRunId: string | null;
    targetWindowStart: number | null;
    targetWindowMatched: boolean | null;
  } | null;
}

export function readWorkflowChildSummaries(args: {
  rootDir: string;
  setupRunId: string | null;
  inventoryRunId: string | null;
  copyRunId: string;
  verifyRunId: string;
}): WorkflowChildSummaries {
  const runsDir = path.join(args.rootDir, "runs");

  return {
    setup: args.setupRunId ? readSetupSummary(path.join(runsDir, args.setupRunId, "setup.json"), args.setupRunId) : null,
    inventory: args.inventoryRunId
      ? readInventorySummary(path.join(runsDir, args.inventoryRunId, "inventory.json"), args.inventoryRunId)
      : null,
    copy: readCopySummary(path.join(runsDir, args.copyRunId, "checkpoint.json"), args.copyRunId),
    verify: readVerifySummary(path.join(runsDir, args.verifyRunId, "verification.json"), args.verifyRunId)
  };
}

function readSetupSummary(setupPath: string, runId: string): WorkflowChildSummaries["setup"] {
  if (!fs.existsSync(setupPath)) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(setupPath, "utf8")) as SetupArtifact;
  return {
    runId,
    outcome: typeof parsed.outcome === "string" ? parsed.outcome : null,
    firstVideoUrl: typeof parsed.firstVideoUrl === "string" ? parsed.firstVideoUrl : null
  };
}

function readInventorySummary(inventoryPath: string, runId: string): WorkflowChildSummaries["inventory"] {
  if (!fs.existsSync(inventoryPath)) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(inventoryPath, "utf8")) as InventoryArtifact;
  return {
    runId,
    total: typeof parsed.total === "number" ? parsed.total : null,
    scrollPasses: typeof parsed.scrollPasses === "number" ? parsed.scrollPasses : null,
    requestedMaxItems: typeof parsed.requestedMaxItems === "number" ? parsed.requestedMaxItems : null,
    bounded: typeof parsed.bounded === "boolean" ? parsed.bounded : null,
    fingerprint: parsed.fingerprint ?? null
  };
}

function readCopySummary(checkpointPath: string, runId: string): WorkflowChildSummaries["copy"] {
  const checkpoint = readCheckpointFile(checkpointPath);
  if (!checkpoint || checkpoint.phase !== "copy") {
    return null;
  }

  return {
    runId,
    processed: readNumericCheckpointField(checkpoint, "processed"),
    total: readNumericCheckpointField(checkpoint, "total"),
    savedCount: readNumericCheckpointField(checkpoint, "savedCount"),
    alreadySavedCount: readNumericCheckpointField(checkpoint, "alreadySavedCount"),
    expectedNonCopyableCount: readNumericCheckpointField(checkpoint, "expectedNonCopyableCount"),
    ambiguousBlockedCount: readNumericCheckpointField(checkpoint, "ambiguousBlockedCount"),
    retryExhaustedCount: readNumericCheckpointField(checkpoint, "retryExhaustedCount"),
    skippedCount: readNumericCheckpointField(checkpoint, "skippedCount"),
    failedCount: readNumericCheckpointField(checkpoint, "failedCount")
  };
}

function readVerifySummary(verificationPath: string, runId: string): WorkflowChildSummaries["verify"] {
  if (!fs.existsSync(verificationPath)) {
    return null;
  }

  const report = readVerificationReport(verificationPath) as ReturnType<typeof readVerificationReport> & {
    verificationMode?: "full" | "subset";
    targetWindowStart?: number | null;
    targetWindowMatched?: boolean | null;
  };

  return {
    runId,
    passed: typeof report.passed === "boolean" ? report.passed : null,
    targetPassed: typeof report.targetPassed === "boolean" ? report.targetPassed : null,
    driftPassed: typeof report.driftPassed === "boolean" ? report.driftPassed : null,
    verificationMode:
      report.productionDeleteAuthorization.verificationMode === "full" ||
      report.productionDeleteAuthorization.verificationMode === "subset"
        ? report.productionDeleteAuthorization.verificationMode
        : report.verificationMode === "full" || report.verificationMode === "subset"
          ? report.verificationMode
          : null,
    deletionEligible: report.productionDeleteAuthorization.authorized,
    deletionBlockedBy: report.productionDeleteAuthorization.reasons,
    authorizationVerificationRunId:
      typeof report.productionDeleteAuthorization.verificationRunId === "string" ? report.productionDeleteAuthorization.verificationRunId : null,
    targetWindowStart: typeof report.targetWindowStart === "number" ? report.targetWindowStart : null,
    targetWindowMatched: typeof report.targetWindowMatched === "boolean" ? report.targetWindowMatched : null
  };
}

function readNumericCheckpointField(checkpoint: CheckpointRecord, key: string): number | null {
  const value = checkpoint.payload[key];
  return typeof value === "number" ? value : null;
}
