import path from "node:path";

import type { Command } from "commander";

import { loadConfig } from "../config/loadConfig.js";
import { openDatabase } from "../db/bootstrap.js";
import { writeCheckpointFile } from "../services/checkpointFile.js";
import { createEventLogger } from "../services/eventLogger.js";
import type { Phase, RunArtifacts, RunConfig } from "../models/types.js";
import { createRunArtifacts } from "../utils/filesystem.js";
import { makeRunId } from "../utils/time.js";
import { isoNow } from "../utils/time.js";

export interface RunContext {
  rootDir: string;
  runId: string;
  config: RunConfig;
  artifacts: RunArtifacts;
  db: ReturnType<typeof openDatabase>;
  logEvent: ReturnType<typeof createEventLogger>["logEvent"];
  saveCheckpoint: (phase: Phase, payload: Record<string, unknown>) => void;
}

export function createRunContext(
  command: Command,
  phase: Phase,
  contextOptions: {
    consoleStream?: NodeJS.WritableStream;
  } = {}
): RunContext {
  const commandLike = command as Command & {
    optsWithGlobals?: () => Record<string, unknown>;
  };

  const options = (
    commandLike.optsWithGlobals
      ? commandLike.optsWithGlobals()
      : command.opts()
  ) as {
    config?: string;
    runId?: string;
    profileDir?: string;
    storageState?: string;
    expectedAccount?: string;
    browserChannel?: string;
    browserExecutablePath?: string;
    browserCdpUrl?: string;
    headless?: boolean;
    slowMoMs?: string;
  };

  const rootDir = process.cwd();
  const config = {
    ...loadConfig(options.config),
    ...(options.profileDir ? { profileDir: options.profileDir } : {}),
    ...(options.storageState ? { storageStatePath: options.storageState } : {}),
    ...(options.expectedAccount ? { expectedAccount: options.expectedAccount } : {}),
    ...(options.browserChannel ? { browserChannel: options.browserChannel } : {}),
    ...(options.browserExecutablePath ? { browserExecutablePath: options.browserExecutablePath } : {}),
    ...(options.browserCdpUrl ? { browserCdpUrl: options.browserCdpUrl } : {}),
    ...(typeof options.headless === "boolean" && options.headless ? { headless: true } : {}),
    ...(options.slowMoMs ? { slowMoMs: Number(options.slowMoMs) } : {})
  };
  const runId = options.runId ?? makeRunId();
  const artifacts = createRunArtifacts(path.resolve(rootDir), runId, config.artifactsDirName);
  const db = openDatabase(artifacts.dbPath, runId);
  const eventLogger = createEventLogger(artifacts.eventsPath, artifacts.logPath, runId, contextOptions.consoleStream);

  db.upsertRunState(phase, "running");
  eventLogger.logEvent(phase, "info", "run.started", "Run started", {
    phase,
    runDir: artifacts.runDir
  });

  return {
    rootDir,
    runId,
    config,
    artifacts,
    db,
    logEvent: (eventPhase, level, eventType, message, details) => {
      eventLogger.logEvent(eventPhase, level, eventType, message, details);
      db.insertEvent({
        runId,
        phase: eventPhase,
        level,
        eventType,
        message,
        ...(details ? { details } : {}),
        createdAt: isoNow()
      });
    },
    saveCheckpoint: (checkpointPhase, payload) => {
      db.saveCheckpoint(checkpointPhase, payload);
      writeCheckpointFile(artifacts.checkpointPath, checkpointPhase, payload);
    }
  };
}
