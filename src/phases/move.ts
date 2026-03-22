import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { writeRunSummary } from "../services/summaryWriter.js";
import { appendTargetPlaylistArgs, getTargetPlaylistRequest } from "../services/targetPlaylist.js";

interface GlobalOptions {
  config?: string;
  profileDir?: string;
  storageState?: string;
  expectedAccount?: string;
  browserChannel?: string;
  browserExecutablePath?: string;
  browserCdpUrl?: string;
  headless?: boolean;
  slowMoMs?: string;
}

interface MoveOptions extends GlobalOptions {
  json?: boolean;
  targetPlaylist?: string;
  targetPlaylistId?: string;
  sourceRunId?: string;
  skipSetup?: boolean;
  developmentMaxItems?: string;
  maxAttempts?: string;
  retryInitialDelayMs?: string;
  retryMaxDelayMs?: string;
  jitterMinMs?: string;
  jitterMaxMs?: string;
  cooldownEvery?: string;
  cooldownMs?: string;
  maxItems?: string;
}

function writeJson(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeJsonLine(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function getMoveOptions(command: Command): MoveOptions {
  const commandLike = command as Command & {
    optsWithGlobals?: () => Record<string, unknown>;
  };

  return (commandLike.optsWithGlobals ? commandLike.optsWithGlobals() : command.opts()) as MoveOptions;
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

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

function thumbnailUrlForVideoId(videoId: string | null | undefined): string | null {
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}

function readJsonFileIfPresent<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function readNewJsonLines<T>(
  filePath: string,
  state: {
    offset: number;
    buffer: string;
  }
): T[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf8");
  const chunk = content.slice(state.offset);
  if (chunk.length === 0) {
    return [];
  }

  state.offset = content.length;
  const combined = state.buffer + chunk;
  const lines = combined.split("\n");
  state.buffer = lines.pop() ?? "";

  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

async function runChildPhase(args: {
  rootDir: string;
  globalArgs: string[];
  childRunId: string;
  phase: "run" | "delete";
  phaseArgs: string[];
}): Promise<void> {
  const tsxPath = path.join(args.rootDir, "node_modules", ".bin", "tsx");
  const cliPath = path.join(args.rootDir, "src", "cli.ts");
  const childArgs = [...args.globalArgs, "--run-id", args.childRunId, args.phase, ...args.phaseArgs];

  const child = spawn(tsxPath, [cliPath, ...childArgs], {
    cwd: args.rootDir,
    stdio: "pipe"
  });

  child.stdout.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Phase '${args.phase}' failed with exit code ${code ?? "unknown"}`));
        return;
      }

      resolve();
    });
  });
}

interface MoveStreamEmitter {
  emit: (payload: Record<string, unknown>) => void;
  startPhase: (phase: string, details?: Record<string, unknown>) => void;
  completePhase: (phase: string, details?: Record<string, unknown>) => void;
}

function createMoveStreamEmitter(enabled: boolean, runId: string): MoveStreamEmitter {
  const emit = (payload: Record<string, unknown>) => {
    if (!enabled) {
      return;
    }

    writeJsonLine({
      runId,
      ...payload
    });
  };

  return {
    emit,
    startPhase: (phase, details) => {
      emit({
        type: "phase",
        phase,
        status: "started",
        ...(details ?? {})
      });
    },
    completePhase: (phase, details) => {
      emit({
        type: "phase",
        phase,
        status: "completed",
        ...(details ?? {})
      });
    }
  };
}

async function monitorRunWorkflow(args: {
  emitter: MoveStreamEmitter;
  rootDir: string;
  workflowRunId: string;
  sourceRunId?: string;
  skipSetup?: boolean;
  childPromise: Promise<void>;
}): Promise<void> {
  const setupRunId = `${args.workflowRunId}-setup`;
  const inventoryRunId = `${args.workflowRunId}-inventory`;
  const copyRunId = `${args.workflowRunId}-copy`;
  const verifyRunId = `${args.workflowRunId}-verify`;

  const phaseStates = {
    setup: {
      runId: setupRunId,
      startPath: path.join(args.rootDir, "runs", setupRunId),
      completionPath: path.join(args.rootDir, "runs", setupRunId, "setup.json"),
      enabled: !args.skipSetup,
      started: false,
      completed: false
    },
    inventory: {
      runId: inventoryRunId,
      startPath: path.join(args.rootDir, "runs", inventoryRunId),
      completionPath: path.join(args.rootDir, "runs", inventoryRunId, "inventory.json"),
      enabled: !args.sourceRunId,
      started: false,
      completed: false
    },
    copy: {
      runId: copyRunId,
      startPath: path.join(args.rootDir, "runs", copyRunId),
      completionPath: path.join(args.rootDir, "runs", verifyRunId),
      enabled: true,
      started: false,
      completed: false
    },
    verify: {
      runId: verifyRunId,
      startPath: path.join(args.rootDir, "runs", verifyRunId),
      completionPath: path.join(args.rootDir, "runs", verifyRunId, "verification.json"),
      enabled: true,
      started: false,
      completed: false
    }
  };

  const copyOperationsPath = path.join(args.rootDir, "runs", copyRunId, "copy-operations.jsonl");
  const copyCheckpointPath = path.join(args.rootDir, "runs", copyRunId, "checkpoint.json");
  const copyOperationState = { offset: 0, buffer: "" };
  let childComplete = false;

  args.childPromise.finally(() => {
    childComplete = true;
  });

  while (!childComplete) {
    for (const [phase, state] of Object.entries(phaseStates)) {
      if (!state.enabled) {
        continue;
      }

      if (!state.started && fs.existsSync(state.startPath)) {
        state.started = true;
        args.emitter.startPhase(phase, { childRunId: state.runId });
      }

      if (!state.completed && fs.existsSync(state.completionPath)) {
        state.completed = true;
        args.emitter.completePhase(phase, { childRunId: state.runId });
      }
    }

    const copyCheckpoint = readJsonFileIfPresent<{
      total?: number;
      processedCount?: number;
    }>(copyCheckpointPath);
    const copyOperations = readNewJsonLines<{
      sourceIndex: number;
      title: string | null;
      videoId: string | null;
      videoUrl: string | null;
      result: string;
      timestamp: string;
    }>(copyOperationsPath, copyOperationState);

    for (const operation of copyOperations) {
      args.emitter.emit({
        type: "item",
        phase: "copy",
        completed: copyCheckpoint?.processedCount ?? null,
        total: copyCheckpoint?.total ?? null,
        item: {
          sourceIndex: operation.sourceIndex,
          title: operation.title,
          videoId: operation.videoId,
          videoUrl: operation.videoUrl,
          thumbnailUrl: thumbnailUrlForVideoId(operation.videoId),
          result: operation.result
        },
        occurredAt: operation.timestamp
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  await args.childPromise;

  for (const [phase, state] of Object.entries(phaseStates)) {
    if (!state.enabled) {
      continue;
    }

    if (!state.started && fs.existsSync(state.startPath)) {
      args.emitter.startPhase(phase, { childRunId: state.runId });
    }

    if (!state.completed && fs.existsSync(state.completionPath)) {
      args.emitter.completePhase(phase, { childRunId: state.runId });
    }
  }
}

async function monitorDeleteWorkflow(args: {
  emitter: MoveStreamEmitter;
  rootDir: string;
  deleteRunId: string;
  childPromise: Promise<void>;
}): Promise<void> {
  const deleteCheckpointPath = path.join(args.rootDir, "runs", args.deleteRunId, "checkpoint.json");
  const deleteSummaryPath = path.join(args.rootDir, "runs", args.deleteRunId, "summary.json");
  const deleteOperationsPath = path.join(args.rootDir, "runs", args.deleteRunId, "delete-operations.jsonl");
  const deleteOperationState = { offset: 0, buffer: "" };
  let started = false;
  let completed = false;
  let childComplete = false;

  args.childPromise.finally(() => {
    childComplete = true;
  });

  while (!childComplete) {
    if (!started && fs.existsSync(path.join(args.rootDir, "runs", args.deleteRunId))) {
      started = true;
      args.emitter.startPhase("delete", { childRunId: args.deleteRunId });
    }

    const deleteCheckpoint = readJsonFileIfPresent<{
      total?: number;
      processed?: number;
    }>(deleteCheckpointPath);
    const deleteOperations = readNewJsonLines<{
      sourceIndex: number;
      title: string | null;
      videoId: string | null;
      videoUrl: string | null;
      result: string;
      timestamp: string;
    }>(deleteOperationsPath, deleteOperationState);

    for (const operation of deleteOperations) {
      args.emitter.emit({
        type: "item",
        phase: "delete",
        completed: deleteCheckpoint?.processed ?? null,
        total: deleteCheckpoint?.total ?? null,
        item: {
          sourceIndex: operation.sourceIndex,
          title: operation.title,
          videoId: operation.videoId,
          videoUrl: operation.videoUrl,
          thumbnailUrl: thumbnailUrlForVideoId(operation.videoId),
          result: operation.result
        },
        occurredAt: operation.timestamp
      });
    }

    if (!completed && fs.existsSync(deleteSummaryPath)) {
      completed = true;
      args.emitter.completePhase("delete", { childRunId: args.deleteRunId });
    }

    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  await args.childPromise;

  if (!started && fs.existsSync(path.join(args.rootDir, "runs", args.deleteRunId))) {
    args.emitter.startPhase("delete", { childRunId: args.deleteRunId });
  }

  if (!completed && fs.existsSync(deleteSummaryPath)) {
    args.emitter.completePhase("delete", { childRunId: args.deleteRunId });
  }
}

export async function runMove(command: Command): Promise<void> {
  const options = getMoveOptions(command);
  const json = Boolean(options.json);
  const ctx = createRunContext(command, "move", json ? { consoleStream: process.stderr } : {});
  const emitter = createMoveStreamEmitter(json, ctx.runId);
  const targetRequest = getTargetPlaylistRequest(options);
  const targetPlaylist = targetRequest.targetPlaylist;
  const targetPlaylistId = targetRequest.targetPlaylistId;
  const workflowRunId = `${ctx.runId}-run`;
  const verifyRunId = `${workflowRunId}-verify`;
  const deleteRunId = `${ctx.runId}-delete`;
  const globalArgs = buildGlobalArgs(options);
  const developmentMaxItems = parsePositiveInt(options.developmentMaxItems);
  const skipDelete = developmentMaxItems !== null;

  if (options.maxItems) {
    const message = "The move command does not support --max-items because deletion requires full verification of the source snapshot.";

    if (json) {
      writeJson({
        ok: false,
        runId: ctx.runId,
        error: message
      });
      process.exitCode = 1;
      return;
    }

    throw new Error(message);
  }

  const runArgs: string[] = [];
  appendTargetPlaylistArgs(runArgs, targetRequest);
  appendOptionalArg(runArgs, "--source-run-id", options.sourceRunId);
  if (developmentMaxItems !== null) {
    runArgs.push("--max-items", String(developmentMaxItems));
  }
  appendOptionalArg(runArgs, "--max-attempts", options.maxAttempts);
  appendOptionalArg(runArgs, "--retry-initial-delay-ms", options.retryInitialDelayMs);
  appendOptionalArg(runArgs, "--retry-max-delay-ms", options.retryMaxDelayMs);
  appendOptionalArg(runArgs, "--jitter-min-ms", options.jitterMinMs);
  appendOptionalArg(runArgs, "--jitter-max-ms", options.jitterMaxMs);
  appendOptionalArg(runArgs, "--cooldown-every", options.cooldownEvery);
  appendOptionalArg(runArgs, "--cooldown-ms", options.cooldownMs);

  if (options.skipSetup) {
    runArgs.push("--skip-setup");
  }

  const deleteArgs = ["--verification-run-id", verifyRunId, "--confirm-delete"];
  const summary = {
    capturedAt: new Date().toISOString(),
    phase: "move",
    targetPlaylist,
    targetPlaylistId,
    moveRunId: ctx.runId,
    workflowRunId,
    verifyRunId,
    deleteRunId,
    sourceRunId: options.sourceRunId ?? null,
    developmentMaxItems,
    deleteSkipped: skipDelete
  };

  try {
    ctx.logEvent("move", "info", "move.plan", skipDelete ? "Starting app-facing bounded test workflow" : "Starting app-facing move workflow", {
      targetPlaylist,
      targetPlaylistId,
      workflowRunId,
      verifyRunId,
      deleteRunId,
      sourceRunId: options.sourceRunId ?? null,
      developmentMaxItems,
      deleteSkipped: skipDelete
    });
    emitter.emit({
      type: "started",
      targetPlaylist,
      targetPlaylistId,
      workflow: {
        workflowRunId,
        verifyRunId,
        deleteRunId
      }
    });

    const workflowPromise = runChildPhase({
      rootDir: ctx.rootDir,
      globalArgs,
      childRunId: workflowRunId,
      phase: "run",
      phaseArgs: runArgs
    });
    await monitorRunWorkflow({
      emitter,
      rootDir: ctx.rootDir,
      workflowRunId,
      childPromise: workflowPromise,
      ...(options.sourceRunId ? { sourceRunId: options.sourceRunId } : {}),
      ...(options.skipSetup ? { skipSetup: true } : {})
    });

    if (skipDelete) {
      emitter.startPhase("delete");
      emitter.completePhase("delete");
    } else {
      const deletePromise = runChildPhase({
        rootDir: ctx.rootDir,
        globalArgs,
        childRunId: deleteRunId,
        phase: "delete",
        phaseArgs: deleteArgs
      });
      await monitorDeleteWorkflow({
        emitter,
        rootDir: ctx.rootDir,
        deleteRunId,
        childPromise: deletePromise
      });
    }

    const workflowSummaryPath = path.join(ctx.rootDir, "runs", workflowRunId, "summary.json");
    const verificationPath = path.join(ctx.rootDir, "runs", verifyRunId, "verification.json");
    const deleteSummaryPath = skipDelete ? null : path.join(ctx.rootDir, "runs", deleteRunId, "summary.json");
    const summaryPath = writeRunSummary(ctx.artifacts.runDir, {
      ...summary,
      succeeded: true,
      workflowSummaryPath,
      verificationPath,
      deleteSummaryPath
    });

    ctx.saveCheckpoint("move", {
      ...summary,
      succeeded: true,
      summaryPath,
      workflowSummaryPath,
      verificationPath,
      deleteSummaryPath
    });
    ctx.logEvent("move", "info", "move.complete", skipDelete ? "Bounded test workflow completed without deletion" : "Move workflow completed", {
      targetPlaylist,
      targetPlaylistId,
      workflowRunId,
      verifyRunId,
      deleteRunId,
      summaryPath,
      developmentMaxItems,
      deleteSkipped: skipDelete
    });
    ctx.db.upsertRunState("move", "complete");

    const payload = {
      ok: true,
      runId: ctx.runId,
      targetPlaylist,
      workflow: {
        workflowRunId,
        verifyRunId,
        deleteRunId
      },
      artifacts: {
        runDir: ctx.artifacts.runDir,
        summaryPath,
        workflowSummaryPath,
        verificationPath,
        deleteSummaryPath
      }
    };

    if (json) {
      emitter.emit({
        type: "result",
        ...payload
      });
      return;
    }

    console.log(`Move completed for '${targetPlaylist}'.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const summaryPath = writeRunSummary(ctx.artifacts.runDir, {
      ...summary,
      succeeded: false,
      error: message
    });

    ctx.saveCheckpoint("move", {
      ...summary,
      succeeded: false,
      summaryPath,
      error: message
    });
    ctx.logEvent("move", "error", "move.failed", "Move workflow failed", {
      targetPlaylist,
      workflowRunId,
      verifyRunId,
      deleteRunId,
      summaryPath,
      error: message
    });
    ctx.db.upsertRunState("move", "failed");

    if (json) {
      emitter.emit({
        type: "result",
        ok: false,
        runId: ctx.runId,
        error: message,
        artifacts: {
          runDir: ctx.artifacts.runDir,
          summaryPath
        }
      });
      process.exitCode = 1;
      return;
    }

    throw error;
  }
}
