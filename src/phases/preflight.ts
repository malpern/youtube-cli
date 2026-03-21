import fs from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { analyzeCopyPerformanceRuns } from "../services/copyPerformance.js";
import { buildFullRunPreflightReport } from "../services/fullRunPreflight.js";
import { readSourceSnapshot, resolveSourceSnapshotPath } from "../services/sourceSnapshot.js";

function getCopyRunIds(command: Command): string[] {
  const options = command.opts<{ copyRunId?: string[] }>();
  return (options.copyRunId ?? []).map((runId) => runId.trim()).filter((runId) => runId.length > 0);
}

export async function runPreflight(command: Command): Promise<void> {
  const ctx = createRunContext(command, "performance");
  const options = command.opts<{ sourceRunId?: string; writePath?: string }>();
  const copyRunIds = getCopyRunIds(command);

  if (copyRunIds.length === 0) {
    throw new Error("At least one --copy-run-id must be provided");
  }

  const snapshotPath = resolveSourceSnapshotPath(ctx.rootDir, ctx.runId, options.sourceRunId);
  const sourceSnapshot = readSourceSnapshot(snapshotPath);
  const performanceReport = analyzeCopyPerformanceRuns(ctx.rootDir, copyRunIds);
  const report = buildFullRunPreflightReport({
    sourceSnapshot,
    performanceReport
  });
  const outputPath = options.writePath
    ? path.resolve(ctx.rootDir, options.writePath)
    : path.join(ctx.artifacts.runDir, "preflight.json");

  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  ctx.logEvent("performance", "info", "preflight.complete", "Full-run preflight report written", {
    sourceSnapshotRunId: sourceSnapshot.runId,
    outputPath,
    snapshotEligibleForProductionAuthorization: report.snapshotEligibleForProductionAuthorization,
    snapshotBlockingReasons: report.snapshotBlockingReasons,
    estimatedMeanCopyHours: report.estimatedCopyDuration.meanHours,
    estimatedP95CopyHours: report.estimatedCopyDuration.p95Hours
  });
  ctx.db.upsertRunState("performance", "complete");

  console.log(JSON.stringify({ outputPath, sourceSnapshotRunId: sourceSnapshot.runId }, null, 2));
}
