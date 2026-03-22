import fs from "node:fs";
import path from "node:path";

import type { DeletionEligibilityDecision, InventoryItem, ProductionDeleteAuthorization, VerificationMismatch } from "../models/types.js";

export interface VerificationCountEvaluation {
  targetCountMatches: boolean;
  driftCountMatches: boolean;
}

export interface InventoryDiscrepancySummary {
  missingOccurrenceKeys: string[];
  extraOccurrenceKeys: string[];
  orderMismatchCount: number;
  orderMismatches: Array<{
    sourceIndex: number;
    expectedOccurrenceKey: string;
    actualOccurrenceKey: string | null;
  }>;
}

export function findMatchingWindowStart(sourceItems: InventoryItem[], targetItems: InventoryItem[]): number | null {
  if (sourceItems.length === 0) {
    return 0;
  }

  if (targetItems.length < sourceItems.length) {
    return null;
  }

  const lastStartIndex = targetItems.length - sourceItems.length;
  for (let startIndex = 0; startIndex <= lastStartIndex; startIndex += 1) {
    let matched = true;
    for (let offset = 0; offset < sourceItems.length; offset += 1) {
      const source = sourceItems[offset];
      const target = targetItems[startIndex + offset];

      if (!source || !target || !itemsEquivalent(source, target)) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return startIndex;
    }
  }

  return null;
}

export function compareOrderedPrefix(sourceItems: InventoryItem[], targetItems: InventoryItem[]): VerificationMismatch[] {
  const mismatches: VerificationMismatch[] = [];

  for (let index = 0; index < sourceItems.length; index += 1) {
    const source = sourceItems[index];
    const target = targetItems[index];

    if (!source) {
      continue;
    }

    if (!target) {
      mismatches.push({
        sourceIndex: source.sourceIndex,
        field: "missing-target-item",
        expected: source.videoId ?? source.title,
        actual: null
      });
      continue;
    }

    if (source.videoId && target.videoId && source.videoId !== target.videoId) {
      mismatches.push({
        sourceIndex: source.sourceIndex,
        field: "videoId",
        expected: source.videoId,
        actual: target.videoId
      });
      continue;
    }

    if (!source.videoId && source.videoUrl && target.videoUrl && source.videoUrl !== target.videoUrl) {
      mismatches.push({
        sourceIndex: source.sourceIndex,
        field: "videoUrl",
        expected: source.videoUrl,
        actual: target.videoUrl
      });
      continue;
    }

    if (normalizeText(source.title) !== normalizeText(target.title)) {
      mismatches.push({
        sourceIndex: source.sourceIndex,
        field: "title",
        expected: source.title,
        actual: target.title
      });
    }
  }

  return mismatches;
}

export function evaluateVerificationCounts(args: {
  subsetLimit: number | undefined;
  sourceCount: number;
  targetCount: number;
  driftCount: number;
}): VerificationCountEvaluation {
  const { subsetLimit, sourceCount, targetCount, driftCount } = args;

  return {
    targetCountMatches: subsetLimit ? targetCount >= sourceCount : targetCount === sourceCount,
    driftCountMatches: subsetLimit ? driftCount >= sourceCount : driftCount === sourceCount
  };
}

export function analyzeInventoryDiscrepancies(sourceItems: InventoryItem[], targetItems: InventoryItem[]): InventoryDiscrepancySummary {
  const sourceOccurrenceKeys = buildOccurrenceKeys(sourceItems);
  const targetOccurrenceKeys = buildOccurrenceKeys(targetItems);
  const targetKeySet = new Set(targetOccurrenceKeys);
  const sourceKeySet = new Set(sourceOccurrenceKeys);

  const missingOccurrenceKeys = sourceOccurrenceKeys.filter((key) => !targetKeySet.has(key));
  const extraOccurrenceKeys = targetOccurrenceKeys.filter((key) => !sourceKeySet.has(key));
  const orderMismatches: InventoryDiscrepancySummary["orderMismatches"] = [];

  for (let index = 0; index < sourceOccurrenceKeys.length; index += 1) {
    const expectedOccurrenceKey = sourceOccurrenceKeys[index];
    const actualOccurrenceKey = targetOccurrenceKeys[index] ?? null;

    if (!expectedOccurrenceKey || expectedOccurrenceKey === actualOccurrenceKey) {
      continue;
    }

    orderMismatches.push({
      sourceIndex: sourceItems[index]?.sourceIndex ?? index + 1,
      expectedOccurrenceKey,
      actualOccurrenceKey
    });
  }

  return {
    missingOccurrenceKeys,
    extraOccurrenceKeys,
    orderMismatchCount: orderMismatches.length,
    orderMismatches
  };
}

export function discrepanciesAreClear(summary: InventoryDiscrepancySummary): boolean {
  return (
    summary.missingOccurrenceKeys.length === 0 &&
    summary.extraOccurrenceKeys.length === 0 &&
    summary.orderMismatchCount === 0
  );
}

function normalizeText(value: string | null): string | null {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? null;
}

function itemsEquivalent(source: InventoryItem, target: InventoryItem): boolean {
  if (source.videoId && target.videoId) {
    return source.videoId === target.videoId;
  }

  if (!source.videoId && source.videoUrl && target.videoUrl) {
    return source.videoUrl === target.videoUrl;
  }

  const normalizedSourceTitle = normalizeText(source.title);
  const normalizedTargetTitle = normalizeText(target.title);
  if (normalizedSourceTitle && normalizedTargetTitle) {
    return normalizedSourceTitle === normalizedTargetTitle;
  }

  return source.unavailableKind === target.unavailableKind;
}

function buildOccurrenceKeys(items: InventoryItem[]): string[] {
  const seenCounts = new Map<string, number>();

  return items.map((item) => {
    const identifier = stableIdentifier(item);
    const occurrence = (seenCounts.get(identifier) ?? 0) + 1;
    seenCounts.set(identifier, occurrence);
    return `${identifier}#${occurrence}`;
  });
}

function stableIdentifier(item: InventoryItem): string {
  return item.videoId ?? item.videoUrl ?? normalizeText(item.title) ?? `unavailable:${item.unavailableKind}:${item.sourceIndex}`;
}

// --- Verification Gate ---

export interface VerificationGateInput {
  passed: boolean;
  targetPassed: boolean;
  driftPassed: boolean;
  subsetLimit: number | null;
  sourceSnapshotMetadataComplete: boolean;
  sourceSnapshotBounded: boolean;
  expectedNonCopyableCount: number;
  ambiguousSourceCount: number;
  targetCountMatches: boolean;
  driftCountMatches: boolean;
  targetDiscrepanciesClear: boolean;
  driftDiscrepanciesClear: boolean;
  sourceSnapshotRunId: string | null;
}

export function evaluateDeletionEligibility(input: VerificationGateInput): DeletionEligibilityDecision {
  const reasons: string[] = [];

  if (!input.sourceSnapshotRunId) {
    reasons.push("missing-source-snapshot");
  }

  if (input.subsetLimit !== null) {
    reasons.push("verification-was-subset-only");
  }

  if (!input.sourceSnapshotMetadataComplete) {
    reasons.push("source-snapshot-metadata-incomplete");
  }

  if (input.sourceSnapshotBounded) {
    reasons.push("source-snapshot-was-bounded");
  }

  if (!input.passed) {
    reasons.push("verification-did-not-pass");
  }

  if (!input.targetPassed) {
    reasons.push("target-verification-failed");
  }

  if (!input.driftPassed) {
    reasons.push("source-drift-verification-failed");
  }

  if (input.ambiguousSourceCount > 0) {
    reasons.push("ambiguous-source-items-present");
  }

  if (input.expectedNonCopyableCount > 0) {
    reasons.push("expected-non-copyable-source-items-present");
  }

  if (!input.targetCountMatches) {
    reasons.push("target-count-mismatch");
  }

  if (!input.driftCountMatches) {
    reasons.push("source-drift-count-mismatch");
  }

  if (!input.targetDiscrepanciesClear) {
    reasons.push("target-discrepancies-present");
  }

  if (!input.driftDiscrepanciesClear) {
    reasons.push("source-drift-discrepancies-present");
  }

  return {
    eligible: reasons.length === 0,
    reasons
  };
}

export function buildProductionDeleteAuthorization(args: {
  verificationRunId: string;
  sourceSnapshotRunId: string | null;
  targetPlaylist: string;
  subsetLimit: number | null;
  sourceSnapshotMetadataComplete: boolean;
  sourceSnapshotBounded: boolean;
  eligibility: DeletionEligibilityDecision;
  verifiedAt?: string;
}): ProductionDeleteAuthorization {
  return {
    authorized: args.eligibility.eligible,
    reasons: args.eligibility.reasons,
    verificationRunId: args.verificationRunId,
    sourceSnapshotRunId: args.sourceSnapshotRunId,
    targetPlaylist: args.targetPlaylist,
    verificationMode:
      args.subsetLimit === null && args.sourceSnapshotMetadataComplete && !args.sourceSnapshotBounded ? "full" : "subset",
    verifiedAt: args.verifiedAt ?? new Date().toISOString()
  };
}

// --- Verification Report ---

export interface VerificationReport {
  reportVersion: number;
  reportComplete: boolean;
  capturedAt?: string;
  sourceSnapshotRunId: string;
  sourceSnapshotPath: string;
  targetPlaylist: string;
  targetPlaylistId?: string;
  passed: boolean;
  targetPassed: boolean;
  driftPassed: boolean;
  ambiguousSourceCount: number;
  targetMismatches: Array<{
    sourceIndex: number;
    field: string;
    expected: string | null;
    actual: string | null;
  }>;
  targetDiscrepancySummary?: {
    missingOccurrenceKeys?: string[];
    extraOccurrenceKeys?: string[];
    orderMismatchCount?: number;
    orderMismatches?: Array<{
      sourceIndex: number;
      expectedOccurrenceKey: string;
      actualOccurrenceKey: string | null;
    }>;
  };
  productionDeleteAuthorization: {
    authorized: boolean;
    reasons: string[];
    verificationRunId: string;
    sourceSnapshotRunId: string | null;
    targetPlaylist: string;
    verificationMode: "full" | "subset";
    verifiedAt: string;
  };
}

export function readVerificationReport(reportPath: string): VerificationReport {
  const parsed = JSON.parse(fs.readFileSync(reportPath, "utf8")) as Partial<VerificationReport>;

  if (parsed.reportVersion !== 1) {
    throw new Error(`Verification report at ${reportPath} is unsupported or incomplete. Re-run verify with the current CLI.`);
  }

  if (parsed.reportComplete !== true) {
    throw new Error(`Verification report at ${reportPath} is incomplete. Re-run verify with the current CLI.`);
  }

  if (!parsed.productionDeleteAuthorization) {
    throw new Error(`Verification report at ${reportPath} is missing production delete authorization. Re-run verify with the current CLI.`);
  }

  return parsed as VerificationReport;
}

export function resolveVerificationReportPath(rootDir: string, currentRunId: string, verificationRunId?: string): string {
  const runsDir = path.join(rootDir, "runs");

  if (verificationRunId) {
    const explicitPath = path.join(runsDir, verificationRunId, "verification.json");
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`Verification report not found for run '${verificationRunId}' at ${explicitPath}`);
    }

    return explicitPath;
  }

  if (!fs.existsSync(runsDir)) {
    throw new Error("No runs directory exists yet. Run verification first.");
  }

  const candidates = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== currentRunId)
    .map((entry) => {
      const reportPath = path.join(runsDir, entry.name, "verification.json");
      if (!fs.existsSync(reportPath)) {
        return null;
      }

      const stat = fs.statSync(reportPath);
      return {
        runId: entry.name,
        reportPath,
        mtimeMs: stat.mtimeMs
      };
    })
    .filter((entry): entry is { runId: string; reportPath: string; mtimeMs: number } => entry !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  const latest = candidates[0];
  if (!latest) {
    throw new Error("No verification report was found. Run the verify command first.");
  }

  return latest.reportPath;
}
