import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeRunSummary } from "./summaryWriter.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-writer-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("writeRunSummary", () => {
  it("writes summary.json into the run directory", () => {
    const runDir = makeTempDir();
    const summaryPath = writeRunSummary(runDir, {
      phase: "delete",
      removedCount: 2,
      failedCount: 0
    });

    expect(summaryPath).toBe(path.join(runDir, "summary.json"));
    expect(JSON.parse(fs.readFileSync(summaryPath, "utf8"))).toEqual({
      phase: "delete",
      removedCount: 2,
      failedCount: 0
    });
  });
});
