import { describe, expect, it } from "vitest";

import { buildProductionDeleteAuthorization, evaluateDeletionEligibility } from "./verificationGate.js";

describe("evaluateDeletionEligibility", () => {
  it("allows deletion only for a full clean verification", () => {
    expect(
      evaluateDeletionEligibility({
        passed: true,
        targetPassed: true,
        driftPassed: true,
        subsetLimit: null,
        sourceSnapshotMetadataComplete: true,
        sourceSnapshotBounded: false,
        expectedNonCopyableCount: 0,
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
        sourceSnapshotMetadataComplete: true,
        sourceSnapshotBounded: false,
        expectedNonCopyableCount: 0,
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
        sourceSnapshotMetadataComplete: false,
        sourceSnapshotBounded: false,
        expectedNonCopyableCount: 1,
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
        "source-snapshot-metadata-incomplete",
        "verification-did-not-pass",
        "target-verification-failed",
        "source-drift-verification-failed",
        "ambiguous-source-items-present",
        "expected-non-copyable-source-items-present",
        "target-count-mismatch",
        "source-drift-count-mismatch",
        "target-discrepancies-present",
        "source-drift-discrepancies-present"
      ]
    });
  });

  it("blocks deletion when expected non-copyable source items are present", () => {
    expect(
      evaluateDeletionEligibility({
        passed: true,
        targetPassed: true,
        driftPassed: true,
        subsetLimit: null,
        sourceSnapshotMetadataComplete: true,
        sourceSnapshotBounded: false,
        expectedNonCopyableCount: 1,
        ambiguousSourceCount: 0,
        targetCountMatches: true,
        driftCountMatches: true,
        targetDiscrepanciesClear: true,
        driftDiscrepanciesClear: true,
        sourceSnapshotRunId: "snapshot-a"
      })
    ).toEqual({
      eligible: false,
      reasons: ["expected-non-copyable-source-items-present"]
    });
  });

  it("blocks deletion when the source snapshot was bounded", () => {
    expect(
      evaluateDeletionEligibility({
        passed: true,
        targetPassed: true,
        driftPassed: true,
        subsetLimit: null,
        sourceSnapshotMetadataComplete: true,
        sourceSnapshotBounded: true,
        expectedNonCopyableCount: 0,
        ambiguousSourceCount: 0,
        targetCountMatches: true,
        driftCountMatches: true,
        targetDiscrepanciesClear: true,
        driftDiscrepanciesClear: true,
        sourceSnapshotRunId: "snapshot-a"
      })
    ).toEqual({
      eligible: false,
      reasons: ["source-snapshot-was-bounded"]
    });
  });

  it("blocks deletion when source snapshot metadata is incomplete", () => {
    expect(
      evaluateDeletionEligibility({
        passed: true,
        targetPassed: true,
        driftPassed: true,
        subsetLimit: null,
        sourceSnapshotMetadataComplete: false,
        sourceSnapshotBounded: false,
        expectedNonCopyableCount: 0,
        ambiguousSourceCount: 0,
        targetCountMatches: true,
        driftCountMatches: true,
        targetDiscrepanciesClear: true,
        driftDiscrepanciesClear: true,
        sourceSnapshotRunId: "snapshot-a"
      })
    ).toEqual({
      eligible: false,
      reasons: ["source-snapshot-metadata-incomplete"]
    });
  });
});

describe("buildProductionDeleteAuthorization", () => {
  it("records a full authorized verification explicitly", () => {
    expect(
      buildProductionDeleteAuthorization({
        verificationRunId: "verify-a",
        sourceSnapshotRunId: "snapshot-a",
        targetPlaylist: "Old Watch",
        subsetLimit: null,
        sourceSnapshotMetadataComplete: true,
        sourceSnapshotBounded: false,
        eligibility: {
          eligible: true,
          reasons: []
        },
        verifiedAt: "2026-03-21T00:00:00.000Z"
      })
    ).toEqual({
      authorized: true,
      reasons: [],
      verificationRunId: "verify-a",
      sourceSnapshotRunId: "snapshot-a",
      targetPlaylist: "Old Watch",
      verificationMode: "full",
      verifiedAt: "2026-03-21T00:00:00.000Z"
    });
  });

  it("records subset verification as non-authorizing context", () => {
    expect(
      buildProductionDeleteAuthorization({
        verificationRunId: "verify-b",
        sourceSnapshotRunId: "snapshot-b",
        targetPlaylist: "Old Watch",
        subsetLimit: 10,
        sourceSnapshotMetadataComplete: true,
        sourceSnapshotBounded: false,
        eligibility: {
          eligible: false,
          reasons: ["verification-was-subset-only"]
        },
        verifiedAt: "2026-03-21T00:00:00.000Z"
      })
    ).toEqual({
      authorized: false,
      reasons: ["verification-was-subset-only"],
      verificationRunId: "verify-b",
      sourceSnapshotRunId: "snapshot-b",
      targetPlaylist: "Old Watch",
      verificationMode: "subset",
      verifiedAt: "2026-03-21T00:00:00.000Z"
    });
  });

  it("records bounded snapshots as subset-mode authorization context", () => {
    expect(
      buildProductionDeleteAuthorization({
        verificationRunId: "verify-c",
        sourceSnapshotRunId: "snapshot-c",
        targetPlaylist: "Old Watch",
        subsetLimit: null,
        sourceSnapshotMetadataComplete: true,
        sourceSnapshotBounded: true,
        eligibility: {
          eligible: false,
          reasons: ["source-snapshot-was-bounded"]
        },
        verifiedAt: "2026-03-21T00:00:00.000Z"
      })
    ).toEqual({
      authorized: false,
      reasons: ["source-snapshot-was-bounded"],
      verificationRunId: "verify-c",
      sourceSnapshotRunId: "snapshot-c",
      targetPlaylist: "Old Watch",
      verificationMode: "subset",
      verifiedAt: "2026-03-21T00:00:00.000Z"
    });
  });

  it("records incomplete snapshot metadata as subset authorization context", () => {
    expect(
      buildProductionDeleteAuthorization({
        verificationRunId: "verify-d",
        sourceSnapshotRunId: "snapshot-d",
        targetPlaylist: "Old Watch",
        subsetLimit: null,
        sourceSnapshotMetadataComplete: false,
        sourceSnapshotBounded: false,
        eligibility: {
          eligible: false,
          reasons: ["source-snapshot-metadata-incomplete"]
        },
        verifiedAt: "2026-03-21T00:00:00.000Z"
      })
    ).toEqual({
      authorized: false,
      reasons: ["source-snapshot-metadata-incomplete"],
      verificationRunId: "verify-d",
      sourceSnapshotRunId: "snapshot-d",
      targetPlaylist: "Old Watch",
      verificationMode: "subset",
      verifiedAt: "2026-03-21T00:00:00.000Z"
    });
  });
});
