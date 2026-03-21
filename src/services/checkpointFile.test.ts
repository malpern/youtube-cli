import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canResumeFromCheckpoint, readCheckpointFile, writeCheckpointFile } from "./checkpointFile.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-watchlist-checkpoint-"));
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

describe("readCheckpointFile", () => {
  it("returns null when the checkpoint file does not exist", () => {
    const checkpointPath = path.join(makeTempDir(), "checkpoint.json");

    expect(readCheckpointFile(checkpointPath)).toBeNull();
  });

  it("round-trips a written checkpoint into phase and payload", () => {
    const checkpointPath = path.join(makeTempDir(), "checkpoint.json");
    writeCheckpointFile(checkpointPath, "copy", {
      processed: 25,
      savedCount: 22,
      failedCount: 1
    });

    const checkpoint = readCheckpointFile(checkpointPath);

    expect(checkpoint?.phase).toBe("copy");
    expect(typeof checkpoint?.updatedAt).toBe("string");
    expect(checkpoint?.payload).toEqual({
      processed: 25,
      savedCount: 22,
      failedCount: 1
    });
  });

  it("throws when the checkpoint omits required top-level fields", () => {
    const checkpointPath = path.join(makeTempDir(), "checkpoint.json");
    fs.writeFileSync(checkpointPath, JSON.stringify({ processed: 10 }));

    expect(() => readCheckpointFile(checkpointPath)).toThrow(/missing required fields/);
  });
});

describe("canResumeFromCheckpoint", () => {
  it("requires a checkpoint for the expected phase", () => {
    expect(canResumeFromCheckpoint(null, "copy", ["processed"])).toBe(false);

    expect(
      canResumeFromCheckpoint(
        {
          phase: "inventory",
          updatedAt: "2026-03-21T00:00:00.000Z",
          payload: { processed: 10 }
        },
        "copy",
        ["processed"]
      )
    ).toBe(false);
  });

  it("requires all requested payload fields to be present", () => {
    const checkpoint = {
      phase: "copy" as const,
      updatedAt: "2026-03-21T00:00:00.000Z",
      payload: { processed: 10, savedCount: 8 }
    };

    expect(canResumeFromCheckpoint(checkpoint, "copy", ["processed"])).toBe(true);
    expect(canResumeFromCheckpoint(checkpoint, "copy", ["processed", "savedCount"])).toBe(true);
    expect(canResumeFromCheckpoint(checkpoint, "copy", ["processed", "failedCount"])).toBe(false);
  });
});
