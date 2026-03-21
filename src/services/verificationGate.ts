import type { DeletionEligibilityDecision } from "../models/types.js";

export interface VerificationGateInput {
  passed: boolean;
  targetPassed: boolean;
  driftPassed: boolean;
  subsetLimit: number | null;
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
