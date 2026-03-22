import { spawnSync } from "node:child_process";
import path from "node:path";

import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { readCheckpointFile } from "../services/checkpointFile.js";
import { writeRunSummary } from "../services/summaryWriter.js";
import { appendTargetPlaylistArgs, getTargetPlaylistRequest } from "../services/targetPlaylist.js";
import { readVerificationReport } from "../services/verificationReport.js";
import { evaluateWorkflowProductionReadiness } from "../services/workflowReadiness.js";
import { readWorkflowChildSummaries } from "../services/workflowSummary.js";

interface GlobalOptions {
  config?: string;
  profileDir?: string;
  storageState?: string;
  expectedAccount?: string;
  browserChannel?: string;
  browserExecutablePath?: string;
  browserCdpUrl?: string;
  browserWindowWidth?: string;
  browserWindowHeight?: string;
  browserWindowPositionX?: string;
  browserWindowPositionY?: string;
  browserViewportWidth?: string;
  browserViewportHeight?: string;
  headless?: boolean;
  slowMoMs?: string;
}

interface RunWorkflowOptions extends GlobalOptions {
  targetPlaylist?: string;
  targetPlaylistId?: string;
  maxItems?: string;
  milestoneEvery?: string;
  sourceRunId?: string;
  skipSetup?: boolean;
  maxAttempts?: string;
  retryInitialDelayMs?: string;
  retryMaxDelayMs?: string;
  jitterMinMs?: string;
  jitterMaxMs?: string;
  cooldownEvery?: string;
  cooldownMs?: string;
}

function getRunOptions(command: Command): RunWorkflowOptions {
  const commandLike = command as Command & {
    optsWithGlobals?: () => Record<string, unknown>;
  };

  return (commandLike.optsWithGlobals ? commandLike.optsWithGlobals() : command.opts()) as RunWorkflowOptions;
}

function buildGlobalArgs(options: GlobalOptions): string[] {
  const args: string[] = [];

  appendOptionalArg(args, "--config", options.config);
  appendOptionalArg(args, "--profile-dir", options.profileDir);
  appendOptionalArg(args, "--storage-state", options.storageState);
  appendOptionalArg(args, "--expected-account", options.expectedAccount);
  appendOptionalArg(args, "--browser-channel", options.browserChannel);
  appendOptionalArg(args, "--browser-executable-path", options.browserExecutablePath);
  appendOptionalArg(args, "--browser-cdp-url", options.browserCdpUrl);
  appendOptionalArg(args, "--browser-window-width", options.browserWindowWidth);
  appendOptionalArg(args, "--browser-window-height", options.browserWindowHeight);
  appendOptionalArg(args, "--browser-window-position-x", options.browserWindowPositionX);
  appendOptionalArg(args, "--browser-window-position-y", options.browserWindowPositionY);
  appendOptionalArg(args, "--browser-viewport-width", options.browserViewportWidth);
  appendOptionalArg(args, "--browser-viewport-height", options.browserViewportHeight);
  appendOptionalArg(args, "--slow-mo-ms", options.slowMoMs);

  if (options.headless) {
    args.push("--headless");
  }

  return args;
}

function appendOptionalArg(args: string[], flag: string, value: string | undefined): void {
  if (value && value.trim().length > 0) {
    args.push(flag, value);
  }
}

function runChildPhase(args: {
  rootDir: string;
  globalArgs: string[];
  childRunId: string;
  phase: "setup" | "inventory" | "copy" | "verify";
  phaseArgs: string[];
}): void {
  const tsxPath = path.join(args.rootDir, "node_modules", ".bin", "tsx");
  const cliPath = path.join(args.rootDir, "src", "cli.ts");
  const childArgs = [...args.globalArgs, "--run-id", args.childRunId, args.phase, ...args.phaseArgs];
  const result = spawnSync(tsxPath, [cliPath, ...childArgs], {
    cwd: args.rootDir,
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Phase '${args.phase}' failed with exit code ${result.status ?? "unknown"}`);
  }
}

function childRunDir(rootDir: string, runId: string): string {
  return path.join(rootDir, "runs", runId);
}

function assertCopyChildSucceeded(rootDir: string, runId: string): void {
  const checkpointPath = path.join(childRunDir(rootDir, runId), "checkpoint.json");
  const checkpoint = readCheckpointFile(checkpointPath);

  if (!checkpoint || checkpoint.phase !== "copy") {
    throw new Error(`Copy phase '${runId}' did not produce a copy checkpoint`);
  }

  const failedCount = checkpoint.payload.failedCount;
  if (typeof failedCount !== "number") {
    throw new Error(`Copy phase '${runId}' checkpoint is missing failedCount`);
  }

  if (failedCount > 0) {
    throw new Error(`Copy phase '${runId}' completed with ${failedCount} failed items`);
  }
}

function assertVerifyChildSucceeded(rootDir: string, runId: string): void {
  const verificationPath = path.join(childRunDir(rootDir, runId), "verification.json");
  const verificationReport = readVerificationReport(verificationPath);

  if (!verificationReport.passed) {
    throw new Error(`Verify phase '${runId}' did not pass`);
  }
}

export async function runWorkflow(command: Command): Promise<void> {
  const ctx = createRunContext(command, "run");
  const options = getRunOptions(command);
  const globalArgs = buildGlobalArgs(options);
  const targetRequest = getTargetPlaylistRequest(options);
  const targetPlaylist = targetRequest.targetPlaylist;
  const targetPlaylistId = targetRequest.targetPlaylistId;
  const setupRunId = `${ctx.runId}-setup`;
  const inventoryRunId = `${ctx.runId}-inventory`;
  const copyRunId = `${ctx.runId}-copy`;
  const verifyRunId = `${ctx.runId}-verify`;
  const summary = {
    capturedAt: new Date().toISOString(),
    phase: "run",
    targetPlaylist,
    targetPlaylistId,
    workflowRunId: ctx.runId,
    setupRunId: options.skipSetup ? null : setupRunId,
    inventoryRunId: options.sourceRunId ? null : inventoryRunId,
    sourceRunId: options.sourceRunId ?? inventoryRunId,
    copyRunId,
    verifyRunId,
    maxItems: options.maxItems ? Number(options.maxItems) : null,
    milestoneEvery: options.milestoneEvery ? Number(options.milestoneEvery) : null,
    completedPhases: [] as string[]
  };

  try {
    ctx.logEvent("run", "info", "run.plan", "Starting orchestrated non-destructive workflow", {
      targetPlaylist,
      targetPlaylistId,
      setupRunId: summary.setupRunId,
      inventoryRunId: summary.inventoryRunId,
      sourceRunId: summary.sourceRunId,
      copyRunId,
      verifyRunId,
      maxItems: summary.maxItems
    });

    if (!options.skipSetup) {
      runChildPhase({
        rootDir: ctx.rootDir,
        globalArgs,
        childRunId: setupRunId,
        phase: "setup",
        phaseArgs: (() => {
          const args: string[] = [];
          appendTargetPlaylistArgs(args, targetRequest);
          return args;
        })()
      });
      summary.completedPhases.push("setup");
    }

    if (!options.sourceRunId) {
      const inventoryArgs: string[] = [];
      appendOptionalArg(inventoryArgs, "--max-items", options.maxItems);

      runChildPhase({
        rootDir: ctx.rootDir,
        globalArgs,
        childRunId: inventoryRunId,
        phase: "inventory",
        phaseArgs: inventoryArgs
      });
      summary.completedPhases.push("inventory");
    }

    const copyArgs: string[] = [];
    appendTargetPlaylistArgs(copyArgs, targetRequest);
    copyArgs.push("--source-run-id", summary.sourceRunId);
    appendOptionalArg(copyArgs, "--max-items", options.maxItems);
    appendOptionalArg(copyArgs, "--milestone-every", options.milestoneEvery);
    appendOptionalArg(copyArgs, "--max-attempts", options.maxAttempts);
    appendOptionalArg(copyArgs, "--retry-initial-delay-ms", options.retryInitialDelayMs);
    appendOptionalArg(copyArgs, "--retry-max-delay-ms", options.retryMaxDelayMs);
    appendOptionalArg(copyArgs, "--jitter-min-ms", options.jitterMinMs);
    appendOptionalArg(copyArgs, "--jitter-max-ms", options.jitterMaxMs);
    appendOptionalArg(copyArgs, "--cooldown-every", options.cooldownEvery);
    appendOptionalArg(copyArgs, "--cooldown-ms", options.cooldownMs);
    runChildPhase({
      rootDir: ctx.rootDir,
      globalArgs,
      childRunId: copyRunId,
      phase: "copy",
      phaseArgs: copyArgs
    });
    assertCopyChildSucceeded(ctx.rootDir, copyRunId);
    summary.completedPhases.push("copy");

    const verifyArgs: string[] = [];
    appendTargetPlaylistArgs(verifyArgs, targetRequest);
    verifyArgs.push("--source-run-id", summary.sourceRunId);
    appendOptionalArg(verifyArgs, "--max-items", options.maxItems);
    runChildPhase({
      rootDir: ctx.rootDir,
      globalArgs,
      childRunId: verifyRunId,
      phase: "verify",
      phaseArgs: verifyArgs
    });
    assertVerifyChildSucceeded(ctx.rootDir, verifyRunId);
    summary.completedPhases.push("verify");
    const childSummaries = readWorkflowChildSummaries({
      rootDir: ctx.rootDir,
      setupRunId: summary.setupRunId,
      inventoryRunId: summary.inventoryRunId,
      copyRunId,
      verifyRunId
    });
    const productionReadiness = evaluateWorkflowProductionReadiness(childSummaries);

    const summaryPath = writeRunSummary(ctx.artifacts.runDir, {
      ...summary,
      childSummaries,
      productionReadiness,
      succeeded: true
    });
    ctx.saveCheckpoint("run", {
      ...summary,
      childSummaries,
      productionReadiness,
      summaryPath,
      succeeded: true
    });
    ctx.logEvent("run", "info", "run.complete", "Workflow completed", {
      ...summary,
      childSummaries,
      productionReadiness,
      summaryPath
    });
    ctx.db.upsertRunState("run", "complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const childSummaries = readWorkflowChildSummaries({
      rootDir: ctx.rootDir,
      setupRunId: summary.setupRunId,
      inventoryRunId: summary.inventoryRunId,
      copyRunId,
      verifyRunId
    });
    const productionReadiness = evaluateWorkflowProductionReadiness(childSummaries);
    const summaryPath = writeRunSummary(ctx.artifacts.runDir, {
      ...summary,
      childSummaries,
      productionReadiness,
      succeeded: false,
      error: message
    });
    ctx.saveCheckpoint("run", {
      ...summary,
      childSummaries,
      productionReadiness,
      summaryPath,
      succeeded: false,
      error: message
    });
    ctx.logEvent("run", "error", "run.failed", "Workflow failed", {
      ...summary,
      childSummaries,
      productionReadiness,
      summaryPath,
      error: message
    });
    ctx.db.upsertRunState("run", "failed");
    throw error;
  }
}
