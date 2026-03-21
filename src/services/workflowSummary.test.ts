import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readWorkflowChildSummaries } from "./workflowSummary.js";

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-summary-"));
  tempDirs.push(rootDir);
  fs.mkdirSync(path.join(rootDir, "runs"), { recursive: true });
  return rootDir;
}

function writeRunFile(rootDir: string, runId: string, fileName: string, value: unknown): void {
  const runDir = path.join(rootDir, "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("readWorkflowChildSummaries", () => {
  it("reads child artifact details into a single summary object", () => {
    const rootDir = makeTempRoot();
    writeRunFile(rootDir, "setup-a", "setup.json", {
      outcome: "created",
      firstVideoUrl: "https://www.youtube.com/watch?v=abc"
    });
    writeRunFile(rootDir, "inventory-a", "inventory.json", {
      total: 3,
      scrollPasses: 2,
      requestedMaxItems: 3,
      bounded: true,
      fingerprint: {
        total: 3,
        orderedHash: "hash",
        headIdentifiers: ["a"],
        tailIdentifiers: ["c"]
      }
    });
    writeRunFile(rootDir, "copy-a", "checkpoint.json", {
      phase: "copy",
      updatedAt: "2026-03-21T00:00:00.000Z",
      processed: 3,
      total: 3,
      savedCount: 1,
      alreadySavedCount: 1,
      expectedNonCopyableCount: 1,
      ambiguousBlockedCount: 0,
      retryExhaustedCount: 0,
      skippedCount: 2,
      failedCount: 0
    });
    writeRunFile(rootDir, "verify-a", "verification.json", {
      reportVersion: 1,
      reportComplete: true,
      passed: true,
      targetPassed: true,
      driftPassed: true,
      verificationMode: "subset",
      productionDeleteAuthorization: {
        authorized: false,
        reasons: ["verification-was-subset-only"],
        verificationRunId: "verify-a",
        sourceSnapshotRunId: "snapshot-a",
        targetPlaylist: "Old Watch",
        verificationMode: "subset",
        verifiedAt: "2026-03-21T00:00:00.000Z"
      },
      targetWindowStart: 2,
      targetWindowMatched: true
    });

    expect(
      readWorkflowChildSummaries({
        rootDir,
        setupRunId: "setup-a",
        inventoryRunId: "inventory-a",
        copyRunId: "copy-a",
        verifyRunId: "verify-a"
      })
    ).toEqual({
      setup: {
        runId: "setup-a",
        outcome: "created",
        firstVideoUrl: "https://www.youtube.com/watch?v=abc"
      },
      inventory: {
        runId: "inventory-a",
        total: 3,
        scrollPasses: 2,
        requestedMaxItems: 3,
        bounded: true,
        fingerprint: {
          total: 3,
          orderedHash: "hash",
          headIdentifiers: ["a"],
          tailIdentifiers: ["c"]
        }
      },
      copy: {
        runId: "copy-a",
        processed: 3,
        total: 3,
        savedCount: 1,
        alreadySavedCount: 1,
        expectedNonCopyableCount: 1,
        ambiguousBlockedCount: 0,
        retryExhaustedCount: 0,
        skippedCount: 2,
        failedCount: 0
      },
      verify: {
        runId: "verify-a",
        passed: true,
        targetPassed: true,
        driftPassed: true,
        verificationMode: "subset",
        deletionEligible: false,
        deletionBlockedBy: ["verification-was-subset-only"],
        authorizationVerificationRunId: "verify-a",
        targetWindowStart: 2,
        targetWindowMatched: true
      }
    });
  });
});
