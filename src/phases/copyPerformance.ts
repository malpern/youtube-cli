import fs from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { analyzeCopyPerformanceRuns } from "../services/copyPerformance.js";

function getRunIds(command: Command): string[] {
  const options = command.opts<{ copyRunId?: string[] }>();
  const runIds = options.copyRunId ?? [];
  return runIds.map((runId) => runId.trim()).filter((runId) => runId.length > 0);
}

export async function runCopyPerformance(command: Command): Promise<void> {
  const ctx = createRunContext(command, "performance");
  const options = command.opts<{ writePath?: string }>();
  const copyRunIds = getRunIds(command);

  if (copyRunIds.length === 0) {
    throw new Error("At least one --copy-run-id must be provided");
  }

  const report = analyzeCopyPerformanceRuns(ctx.rootDir, copyRunIds);
  const outputPath = options.writePath
    ? path.resolve(ctx.rootDir, options.writePath)
    : path.join(ctx.artifacts.runDir, "copy-performance.json");

  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  ctx.logEvent("performance", "info", "copy-performance.complete", "Copy performance report written", {
    analyzedRunIds: copyRunIds,
    outputPath,
    runCount: report.runReports.length,
    aggregateTotalDurationMsMean: report.aggregate.totalDurationMs.mean,
    aggregateOverallRateMean: report.aggregate.overallRateItemsPerSecond.mean
  });
  ctx.db.upsertRunState("performance", "complete");

  console.log(JSON.stringify({ outputPath, analyzedRunIds: copyRunIds }, null, 2));
}
