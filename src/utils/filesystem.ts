import fs from "node:fs";
import path from "node:path";

import type { RunArtifacts } from "../models/types.js";

export function ensureDir(dirPath: string): string {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function createRunArtifacts(rootDir: string, runId: string, artifactsDirName: string): RunArtifacts {
  const runDir = ensureDir(path.join(rootDir, "runs", runId));
  const artifactsDir = ensureDir(path.join(runDir, artifactsDirName));
  const screenshotsDir = ensureDir(path.join(artifactsDir, "screenshots"));
  const tracesDir = ensureDir(path.join(artifactsDir, "traces"));

  return {
    runId,
    runDir,
    artifactsDir,
    screenshotsDir,
    tracesDir,
    dbPath: path.join(runDir, "migration.db"),
    eventsPath: path.join(runDir, "events.jsonl"),
    logPath: path.join(runDir, "run.log"),
    checkpointPath: path.join(runDir, "checkpoint.json")
  };
}
