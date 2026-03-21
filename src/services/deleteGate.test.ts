import { describe, expect, it } from "vitest";

import { evaluateDeleteReadiness } from "./deleteGate.js";

describe("evaluateDeleteReadiness", () => {
  it("blocks deletion when confirm-delete is missing", () => {
    expect(
      evaluateDeleteReadiness({
        confirmDelete: false,
        verificationReport: {
          reportVersion: 1,
          reportComplete: true,
          sourceSnapshotRunId: "snapshot-a",
          sourceSnapshotPath: "/tmp/inventory.json",
          targetPlaylist: "Old Watch",
          passed: true,
          targetPassed: true,
          driftPassed: true,
          ambiguousSourceCount: 0,
          targetMismatches: [],
          productionDeleteAuthorization: {
            authorized: true,
            reasons: [],
            verificationRunId: "verify-a",
            sourceSnapshotRunId: "snapshot-a",
            targetPlaylist: "Old Watch",
            verificationMode: "full",
            verifiedAt: "2026-03-21T00:00:00.000Z"
          }
        }
      })
    ).toEqual({
      allowed: false,
      reasons: ["missing-confirm-delete"]
    });
  });

  it("blocks deletion when verification is not delete-eligible", () => {
    expect(
      evaluateDeleteReadiness({
        confirmDelete: true,
        verificationReport: {
          reportVersion: 1,
          reportComplete: true,
          sourceSnapshotRunId: "snapshot-a",
          sourceSnapshotPath: "/tmp/inventory.json",
          targetPlaylist: "Old Watch",
          passed: false,
          targetPassed: false,
          driftPassed: true,
          ambiguousSourceCount: 0,
          targetMismatches: [],
          productionDeleteAuthorization: {
            authorized: false,
            reasons: ["verification-was-subset-only"],
            verificationRunId: "verify-a",
            sourceSnapshotRunId: "snapshot-a",
            targetPlaylist: "Old Watch",
            verificationMode: "subset",
            verifiedAt: "2026-03-21T00:00:00.000Z"
          }
        }
      })
    ).toEqual({
      allowed: false,
      reasons: ["verification-was-subset-only"]
    });
  });

  it("allows deletion only when confirm-delete is present and verification is eligible", () => {
    expect(
      evaluateDeleteReadiness({
        confirmDelete: true,
        verificationReport: {
          reportVersion: 1,
          reportComplete: true,
          sourceSnapshotRunId: "snapshot-a",
          sourceSnapshotPath: "/tmp/inventory.json",
          targetPlaylist: "Old Watch",
          passed: true,
          targetPassed: true,
          driftPassed: true,
          ambiguousSourceCount: 0,
          targetMismatches: [],
          productionDeleteAuthorization: {
            authorized: true,
            reasons: [],
            verificationRunId: "verify-a",
            sourceSnapshotRunId: "snapshot-a",
            targetPlaylist: "Old Watch",
            verificationMode: "full",
            verifiedAt: "2026-03-21T00:00:00.000Z"
          }
        }
      })
    ).toEqual({
      allowed: true,
      reasons: []
    });
  });

});
