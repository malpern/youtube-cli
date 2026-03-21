import fs from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { launchBrowserSession } from "../browser/launch.js";
import { getWatchLaterRowCount, openWatchLaterForDeletion, removeTopWatchLaterItem } from "../browser/youtube/removeFromWatchLater.js";
import { AuthenticationRequiredError, assertAuthenticatedYouTubeSession, throwIfAuthenticationLost } from "../services/authGuard.js";
import { pauseRunForAuthentication } from "../services/authPause.js";
import { readCheckpointFile } from "../services/checkpointFile.js";
import { evaluateDeleteReadiness } from "../services/deleteGate.js";
import { computeMutationPacingDelay, resolveMutationPacingPolicy } from "../services/mutationPacing.js";
import { resolveMutationRetryPolicy, runWithRetries } from "../services/mutationRetry.js";
import { planDeleteResume } from "../services/resumePlanner.js";
import { readSourceSnapshot } from "../services/sourceSnapshot.js";
import { writeRunSummary } from "../services/summaryWriter.js";
import { readVerificationReport, resolveVerificationReportPath } from "../services/verificationReport.js";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function appendDeleteOperation(
  operationsPath: string,
  entry: {
    sourceIndex: number;
    title: string | null;
    videoId: string | null;
    videoUrl: string | null;
    result: string;
    attempts: number;
    error?: string;
    timestamp: string;
  }
): void {
  fs.appendFileSync(operationsPath, `${JSON.stringify(entry)}\n`);
}

export async function runDelete(command: Command): Promise<void> {
  const ctx = createRunContext(command, "delete");
  const localOptions = command.opts<{
    verificationRunId?: string;
    maxItems?: string;
    milestoneEvery?: string;
    resume?: boolean;
    confirmDelete?: boolean;
    maxAttempts?: string;
    retryInitialDelayMs?: string;
    retryMaxDelayMs?: string;
    jitterMinMs?: string;
    jitterMaxMs?: string;
    cooldownEvery?: string;
    cooldownMs?: string;
  }>();
  const milestoneEvery = parsePositiveInt(localOptions.milestoneEvery, 5);
  const retryPolicy = resolveMutationRetryPolicy(localOptions);
  const pacingPolicy = resolveMutationPacingPolicy(localOptions);
  const operationsPath = path.join(ctx.artifacts.runDir, "delete-operations.jsonl");
  const verificationPath = resolveVerificationReportPath(ctx.rootDir, ctx.runId, localOptions.verificationRunId);
  const verificationReport = readVerificationReport(verificationPath);
  const deleteReadiness = evaluateDeleteReadiness({
    confirmDelete: Boolean(localOptions.confirmDelete),
    verificationReport
  });

  if (!deleteReadiness.allowed) {
    ctx.logEvent("delete", "error", "delete.blocked", "Delete is blocked by verification state", {
      verificationPath,
      reasons: deleteReadiness.reasons
    });
    ctx.db.upsertRunState("delete", "failed");
    throw new Error(`Delete blocked: ${deleteReadiness.reasons.join(", ")}`);
  }

  const sourceSnapshot = readSourceSnapshot(verificationReport.sourceSnapshotPath);
  const deleteItems = sourceSnapshot.items.slice(
    0,
    localOptions.maxItems ? parsePositiveInt(localOptions.maxItems, 0) : undefined
  );
  const resumePlan = localOptions.resume
    ? planDeleteResume({
        checkpoint: readCheckpointFile(ctx.artifacts.checkpointPath),
        deleteItems,
        sourceSnapshotRunId: sourceSnapshot.runId,
        verificationPath
      })
    : {
        resumed: false,
        processedCount: 0,
        remainingItems: deleteItems,
        removedCount: 0,
        retryExhaustedCount: 0,
        failedCount: 0
      };

  if (resumePlan.remainingItems.length === 0) {
    const summaryPath = writeRunSummary(ctx.artifacts.runDir, {
      capturedAt: new Date().toISOString(),
      phase: "delete",
      verificationPath,
      sourceSnapshotRunId: sourceSnapshot.runId,
      total: deleteItems.length,
      processed: resumePlan.processedCount,
      removedCount: resumePlan.removedCount,
      retryExhaustedCount: resumePlan.retryExhaustedCount,
      failedCount: resumePlan.failedCount,
      resumed: resumePlan.resumed,
      noop: true
    });
    ctx.logEvent("delete", "info", "delete.noop", "Delete plan has no remaining candidates", {
      verificationPath,
      sourceSnapshotRunId: sourceSnapshot.runId,
      resumed: resumePlan.resumed,
      resumeProcessedCount: resumePlan.processedCount,
      summaryPath
    });
    ctx.saveCheckpoint("delete", {
      verificationPath,
      sourceSnapshotRunId: sourceSnapshot.runId,
      processed: resumePlan.processedCount,
      total: deleteItems.length,
      removedCount: resumePlan.removedCount,
      retryExhaustedCount: resumePlan.retryExhaustedCount,
      failedCount: resumePlan.failedCount
    });
    ctx.db.upsertRunState("delete", "complete");
    return;
  }

  const session = await launchBrowserSession(ctx.config);
  const watchLaterUrl = `${ctx.config.youtubeBaseUrl}/playlist?list=WL`;

  try {
    await openWatchLaterForDeletion(session.page, watchLaterUrl);
    await assertAuthenticatedYouTubeSession(session.page, ctx.config, "delete.start");
    ctx.logEvent("delete", "info", "delete.plan", "Loaded delete plan", {
      verificationPath,
      sourceSnapshotRunId: sourceSnapshot.runId,
      total: deleteItems.length,
      resumed: resumePlan.resumed,
      resumeProcessedCount: resumePlan.processedCount,
      retryPolicy,
      pacingPolicy
    });

    let removedCount = resumePlan.removedCount;
    let retryExhaustedCount = resumePlan.retryExhaustedCount;
    let failedCount = resumePlan.failedCount;

    for (const [index, item] of resumePlan.remainingItems.entries()) {
      try {
        const { attempts } = await runWithRetries({
          policy: retryPolicy,
          run: async () => {
            await assertAuthenticatedYouTubeSession(session.page, ctx.config, `delete.item.${item.sourceIndex}.before`);
            try {
              await removeTopWatchLaterItem(session.page, item);
              await assertAuthenticatedYouTubeSession(session.page, ctx.config, `delete.item.${item.sourceIndex}.after`);
            } catch (error) {
              await throwIfAuthenticationLost(session.page, ctx.config, `delete.item.${item.sourceIndex}.failure`, error);
              throw new Error("Authentication guard should have thrown before continuing");
            }
          },
          onRetry: async ({ attempt, nextAttempt, delayMs, error }) => {
            ctx.logEvent("delete", "warn", "delete.item-retry", "Retrying delete item after failure", {
              sourceIndex: item.sourceIndex,
              title: item.title,
              attempt,
              nextAttempt,
              delayMs,
              error: error.message
            });
          },
          sleep: async (delayMs) => {
            await session.page.waitForTimeout(delayMs);
          },
          shouldRetry: (error) => !(error instanceof AuthenticationRequiredError)
        });
        appendDeleteOperation(operationsPath, {
          sourceIndex: item.sourceIndex,
          title: item.title,
          videoId: item.videoId,
          videoUrl: item.videoUrl,
          result: "removed",
          attempts,
          timestamp: new Date().toISOString()
        });
        removedCount += 1;
      } catch (error) {
        if (error instanceof AuthenticationRequiredError) {
          const completedCount = resumePlan.processedCount + index;
          pauseRunForAuthentication({
            ctx,
            phase: "delete",
            error,
            payload: {
              verificationPath,
              sourceSnapshotRunId: sourceSnapshot.runId,
              processed: completedCount,
              total: deleteItems.length,
              removedCount,
              retryExhaustedCount,
              failedCount
            }
          });
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        const screenshotPath = path.join(ctx.artifacts.screenshotsDir, `delete-failure-${item.sourceIndex}.png`);
        await session.page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
        appendDeleteOperation(operationsPath, {
          sourceIndex: item.sourceIndex,
          title: item.title,
          videoId: item.videoId,
          videoUrl: item.videoUrl,
          result: "failed",
          attempts: retryPolicy.maxAttempts,
          error: message,
          timestamp: new Date().toISOString()
        });
        retryExhaustedCount += 1;
        failedCount += 1;
        ctx.logEvent("delete", "error", "delete.item-failed", "Delete item failed", {
          sourceIndex: item.sourceIndex,
          title: item.title,
          error: message,
          attempts: retryPolicy.maxAttempts,
          ...(fs.existsSync(screenshotPath) ? { screenshotPath } : {})
        });
        throw error;
      }

      const processedCount = resumePlan.processedCount + index + 1;
      if (processedCount % milestoneEvery === 0 || processedCount === deleteItems.length) {
        ctx.logEvent("delete", "info", "delete.progress", "Delete progress milestone", {
          processed: processedCount,
          total: deleteItems.length,
          removedCount,
          retryExhaustedCount,
          failedCount
        });
      }

      ctx.saveCheckpoint("delete", {
        verificationPath,
        sourceSnapshotRunId: sourceSnapshot.runId,
        processed: processedCount,
        total: deleteItems.length,
        removedCount,
        retryExhaustedCount,
        failedCount
      });

      const pacingDelay = computeMutationPacingDelay(pacingPolicy, processedCount);
      if (pacingDelay.totalDelayMs > 0 && processedCount < deleteItems.length) {
        ctx.logEvent("delete", "info", "delete.pacing", "Sleeping between delete items to throttle the mutation rate", {
          processedCount,
          jitterMs: pacingDelay.jitterMs,
          cooldownMs: pacingDelay.cooldownMs,
          totalDelayMs: pacingDelay.totalDelayMs
        });
        await session.page.waitForTimeout(pacingDelay.totalDelayMs);
      }
    }

    const deletingFullSnapshot = deleteItems.length === sourceSnapshot.items.length;
    const remainingRowCount = await getWatchLaterRowCount(session.page);
    const finalEmptyConfirmed = deletingFullSnapshot ? remainingRowCount === 0 : false;
    const summaryPath = writeRunSummary(ctx.artifacts.runDir, {
      capturedAt: new Date().toISOString(),
      phase: "delete",
      verificationPath,
      sourceSnapshotRunId: sourceSnapshot.runId,
      total: deleteItems.length,
      removedCount,
      retryExhaustedCount,
      failedCount,
      remainingRowCount,
      finalEmptyConfirmed,
      resumed: resumePlan.resumed,
      resumeProcessedCount: resumePlan.processedCount,
      operationsPath
    });

    ctx.logEvent("delete", "info", "delete.complete", "Delete pass completed", {
      verificationPath,
      sourceSnapshotRunId: sourceSnapshot.runId,
      total: deleteItems.length,
      removedCount,
      retryExhaustedCount,
      failedCount,
      remainingRowCount,
      finalEmptyConfirmed,
      operationsPath,
      summaryPath
    });
    ctx.db.upsertRunState("delete", failedCount === 0 ? "complete" : "failed");
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      pauseRunForAuthentication({
        ctx,
        phase: "delete",
        error,
        payload: {
          verificationPath,
          sourceSnapshotRunId: sourceSnapshot.runId,
          processed: resumePlan.processedCount,
          total: deleteItems.length,
          removedCount: resumePlan.removedCount,
          retryExhaustedCount: resumePlan.retryExhaustedCount,
          failedCount: resumePlan.failedCount
        }
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    ctx.logEvent("delete", "error", "delete.failed", "Delete pass failed", {
      error: message,
      verificationPath
    });
    ctx.db.upsertRunState("delete", "failed");
    throw error;
  } finally {
    await session.close();
  }
}
