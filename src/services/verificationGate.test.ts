import { describe, expect, it } from "vitest";

import { evaluateDeletionEligibility } from "./verificationGate.js";

describe("evaluateDeletionEligibility", () => {
  it("allows deletion only for a full clean verification", () => {
    expect(
      evaluateDeletionEligibility({
        passed: true,
        targetPassed: true,
        driftPassed: true,
        subsetLimit: null,
        ambiguousSourceCount: 0,
        targetCountMatches: true,
        driftCountMatches: true,
        targetDiscrepanciesClear: true,
        driftDiscrepanciesClear: true,
        sourceSnapshotRunId: "snapshot-a"
      })
    ).toEqual({
      eligible: true,
      reasons: []
    });
  });

  it("blocks deletion for subset-only verification", () => {
    expect(
      evaluateDeletionEligibility({
        passed: true,
        targetPassed: true,
        driftPassed: true,
        subsetLimit: 10,
        ambiguousSourceCount: 0,
        targetCountMatches: true,
        driftCountMatches: true,
        targetDiscrepanciesClear: true,
        driftDiscrepanciesClear: true,
        sourceSnapshotRunId: "snapshot-a"
      })
    ).toEqual({
      eligible: false,
      reasons: ["verification-was-subset-only"]
    });
  });

  it("accumulates multiple blocking reasons", () => {
    expect(
      evaluateDeletionEligibility({
        passed: false,
        targetPassed: false,
        driftPassed: false,
        subsetLimit: null,
        ambiguousSourceCount: 2,
        targetCountMatches: false,
        driftCountMatches: false,
        targetDiscrepanciesClear: false,
        driftDiscrepanciesClear: false,
        sourceSnapshotRunId: null
      })
    ).toEqual({
      eligible: false,
      reasons: [
        "missing-source-snapshot",
        "verification-did-not-pass",
        "target-verification-failed",
        "source-drift-verification-failed",
        "ambiguous-source-items-present",
        "target-count-mismatch",
        "source-drift-count-mismatch",
        "target-discrepancies-present",
        "source-drift-discrepancies-present"
      ]
    });
  });
});
