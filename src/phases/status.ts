import type { Command } from "commander";

import { formatStatusSummary, readRunStatus, resolveStatusRunId } from "../services/runStatus.js";

export async function runStatus(command: Command): Promise<void> {
  const rootDir = process.cwd();
  const options = command.optsWithGlobals<{ inspectRunId?: string; json?: boolean }>();
  const runId = resolveStatusRunId(rootDir, options.inspectRunId);
  const summary = readRunStatus(rootDir, runId);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write(formatStatusSummary(summary));
}
