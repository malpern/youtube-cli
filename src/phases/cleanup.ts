import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { launchBrowserSession } from "../browser/launch.js";
import { cleanupUnavailableVideos } from "../browser/youtube/cleanupUnavailable.js";
import { buildMoveAppPayload } from "../services/appContracts.js";

const PHASE = "chunked-move" as const;

function writeJson(payload: object): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export async function runCleanup(command: Command): Promise<void> {
  const options = command.opts<{ json?: boolean }>();
  const json = Boolean(options.json);
  const ctx = createRunContext(command, PHASE, json ? { consoleStream: process.stderr } : {});

  ctx.logEvent(PHASE, "info", "cleanup.started", "Starting unavailable video cleanup", {});

  const session = await launchBrowserSession(ctx.config);
  const watchLaterUrl = `${ctx.config.youtubeBaseUrl}/playlist?list=WL`;

  try {
    if (json) {
      writeJson(buildMoveAppPayload(ctx.runId, {
        type: "progress",
        phase: "delete",
        completed: 0,
        total: 0,
        message: "Checking for unavailable videos..."
      }));
    }

    const result = await cleanupUnavailableVideos(
      session.page,
      watchLaterUrl,
      (message) => {
        ctx.logEvent(PHASE, "info", "cleanup.progress", message, {});
        if (json) {
          writeJson(buildMoveAppPayload(ctx.runId, {
            type: "progress",
            phase: "delete",
            completed: 0,
            total: 0,
            message
          }));
        }
      }
    );

    ctx.logEvent(PHASE, "info", "cleanup.complete", "Cleanup complete", {
      unavailableFound: result.unavailableFound,
      removedCount: result.removedCount
    });

    if (json) {
      writeJson(buildMoveAppPayload(ctx.runId, {
        type: "result",
        ok: true,
        runId: ctx.runId,
        cleanupResult: {
          unavailableFound: result.unavailableFound,
          removedCount: result.removedCount
        }
      }));
    } else {
      if (result.unavailableFound) {
        console.log(`Removed ${result.removedCount} unavailable videos from Watch Later.`);
      } else {
        console.log("No unavailable videos found in Watch Later.");
      }
    }

    ctx.db.upsertRunState(PHASE, "complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.logEvent(PHASE, "error", "cleanup.failed", "Cleanup failed", { error: message });
    ctx.db.upsertRunState(PHASE, "failed");

    if (json) {
      writeJson(buildMoveAppPayload(ctx.runId, {
        type: "result",
        ok: false,
        runId: ctx.runId,
        error: message
      }));
    }

    throw error;
  } finally {
    await session.close();
  }
}
