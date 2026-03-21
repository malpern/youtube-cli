import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readVerificationReport } from "./verificationReport.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verification-report-"));
  tempDirs.push(dir);
  return dir;
}

function writeReport(value: unknown): string {
  const dir = makeTempDir();
  const reportPath = path.join(dir, "verification.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`);
  return reportPath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("readVerificationReport", () => {
  it("accepts the current verification report shape", () => {
    const reportPath = writeReport({
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
    });

    expect(readVerificationReport(reportPath).reportVersion).toBe(1);
  });

  it("fails closed on legacy reports without version metadata", () => {
    const reportPath = writeReport({
      sourceSnapshotRunId: "snapshot-a",
      sourceSnapshotPath: "/tmp/inventory.json",
      targetPlaylist: "Old Watch",
      passed: true,
      targetPassed: true,
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
    });

    expect(() => readVerificationReport(reportPath)).toThrow(/unsupported or incomplete/i);
  });

  it("fails closed when authorization metadata is missing", () => {
    const reportPath = writeReport({
      reportVersion: 1,
      reportComplete: true,
      sourceSnapshotRunId: "snapshot-a",
      sourceSnapshotPath: "/tmp/inventory.json",
      targetPlaylist: "Old Watch",
      passed: true,
      targetPassed: true,
      driftPassed: true,
      ambiguousSourceCount: 0,
      targetMismatches: []
    });

    expect(() => readVerificationReport(reportPath)).toThrow(/missing production delete authorization/i);
  });
});
