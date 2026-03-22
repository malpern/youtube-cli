import fs from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { launchBrowserSession } from "../browser/launch.js";
import { ensureVideoSavedToPlaylist } from "../browser/youtube/saveToPlaylist.js";
import type { SaveToPlaylistTimings } from "../browser/youtube/saveToPlaylist.js";
import type { InventoryItem } from "../models/types.js";
import { AuthenticationRequiredError, assertAuthenticatedYouTubeSession, throwIfAuthenticationLost } from "../services/authGuard.js";
import { pauseRunForAuthentication } from "../services/authPause.js";
import { readCheckpointFile } from "../services/checkpointFile.js";
import { computeMutationPacingDelay, resolveMutationPacingPolicy } from "../services/mutationPacing.js";
import { resolveMutationRetryPolicy, runWithRetries } from "../services/mutationRetry.js";
import { readSourceSnapshot, resolveSourceSnapshotPath } from "../services/sourceSnapshot.js";
import { assessSourceItemPolicy } from "../services/sourceItemPolicy.js";
import { planRepair } from "../services/repairPlanner.js";
import { planRepairResume } from "../services/resumePlanner.js";
import { getTargetPlaylistRequest, resolveTargetPlaylistForSavePanel } from "../services/targetPlaylist.js";
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

function appendRepairOperation(
  operationsPath: string,
  entry: {
    sourceIndex: number;
    title: string | null;
    videoId: string | null;
    videoUrl: string | null;
    result: string;
    attempts: number;
    timings?: SaveToPlaylistTimings;
    error?: string;
    timestamp: string;
  }
): void {
  fs.appendFileSync(operationsPath, `${JSON.stringify(entry)}\n`);
}

export async function runRepair(command: Command): Promise<void> {
  const ctx = createRunContext(command, "repair");
  const localOptions = command.opts<{
    targetPlaylist?: string;
    targetPlaylistId?: string;
    verificationRunId?: string;
    milestoneEvery?: string;
    maxItems?: string;
    resume?: boolean;
    maxAttempts?: string;
    retryInitialDelayMs?: string;
    retryMaxDelayMs?: string;
    jitterMinMs?: string;
    jitterMaxMs?: string;
    cooldownEvery?: string;
    cooldownMs?: string;
  }>();
  const targetRequest = getTargetPlaylistRequest(localOptions);
  const targetPlaylist = targetRequest.targetPlaylist;
  const targetPlaylistId = targetRequest.targetPlaylistId;
  const milestoneEvery = parsePositiveInt(localOptions.milestoneEvery, 5);
  const retryPolicy = resolveMutationRetryPolicy(localOptions);
  const pacingPolicy = resolveMutationPacingPolicy(localOptions);
  const operationsPath = path.join(ctx.artifacts.runDir, "repair-operations.jsonl");
  const verificationPath = resolveVerificationReportPath(ctx.rootDir, ctx.runId, localOptions.verificationRunId);
  const verificationReport = readVerificationReport(verificationPath);
  const snapshotPath = resolveSourceSnapshotPath(ctx.rootDir, ctx.runId, verificationReport.sourceSnapshotRunId);
  const sourceSnapshot = readSourceSnapshot(snapshotPath);
  const repairPlan = planRepair(verificationReport, sourceSnapshot.items);
  const repairItems = repairPlan.sourceIndicesToRetry
    .map((sourceIndex) => sourceSnapshot.items.find((item) => item.sourceIndex === sourceIndex))
    .filter((item): item is InventoryItem => item !== undefined)
    .slice(0, localOptions.maxItems ? parsePositiveInt(localOptions.maxItems, 0) : undefined);

  if (
    verificationReport.targetPlaylist !== targetPlaylist &&
    (!targetPlaylistId || verificationReport.targetPlaylistId !== targetPlaylistId)
  ) {
    throw new Error(
      `Verification report target playlist '${verificationReport.targetPlaylist}' does not match requested target playlist '${targetPlaylist}'`
    );
  }

  if (repairPlan.blockedReasons.length > 0) {
    ctx.logEvent("repair", "error", "repair.blocked", "Repair is blocked by verification state", {
      verificationPath,
      blockedReasons: repairPlan.blockedReasons,
      targetPlaylist,
      targetPlaylistId
    });
    ctx.db.upsertRunState("repair", "failed");
    throw new Error(`Repair blocked: ${repairPlan.blockedReasons.join(", ")}`);
  }

  const resumePlan = localOptions.resume
    ? planRepairResume({
        checkpoint: readCheckpointFile(ctx.artifacts.checkpointPath),
        repairItems,
        sourceSnapshotRunId: sourceSnapshot.runId,
        targetPlaylist,
        verificationPath
      })
    : {
        resumed: false,
        processedCount: 0,
        remainingItems: repairItems,
        repairedCount: 0,
        savedCount: 0,
        alreadySavedCount: 0,
        policySkippedCount: 0,
        retryExhaustedCount: 0,
        skippedCount: 0,
        failedCount: 0
      };

  if (resumePlan.remainingItems.length === 0) {
    ctx.logEvent("repair", "info", "repair.noop", "Repair plan has no retry candidates", {
      verificationPath,
      sourceSnapshotRunId: sourceSnapshot.runId,
      targetPlaylist,
      targetPlaylistId,
      resumed: resumePlan.resumed,
      resumeProcessedCount: resumePlan.processedCount
    });
    ctx.saveCheckpoint("repair", {
      verificationPath,
      sourceSnapshotRunId: sourceSnapshot.runId,
      targetPlaylist,
      processed: resumePlan.processedCount,
      total: repairItems.length,
      repairedCount: resumePlan.repairedCount,
      savedCount: resumePlan.savedCount,
      alreadySavedCount: resumePlan.alreadySavedCount,
      policySkippedCount: resumePlan.policySkippedCount,
      retryExhaustedCount: resumePlan.retryExhaustedCount,
      skippedCount: resumePlan.skippedCount,
      failedCount: resumePlan.failedCount
    });
    ctx.db.upsertRunState("repair", "complete");
    return;
  }

  const session = await launchBrowserSession(ctx.config);

  try {
    ctx.logEvent("repair", "info", "repair.plan", "Loaded repair plan", {
      verificationPath,
      sourceSnapshotRunId: sourceSnapshot.runId,
      sourceSnapshotPath: snapshotPath,
      retryCount: repairItems.length,
      targetPlaylist,
      resumed: resumePlan.resumed,
      resumeProcessedCount: resumePlan.processedCount,
      retryPolicy,
      pacingPolicy
    });

    let repairedCount = resumePlan.repairedCount;
    let savedCount = resumePlan.savedCount;
    let alreadySavedCount = resumePlan.alreadySavedCount;
    let policySkippedCount = resumePlan.policySkippedCount;
    let retryExhaustedCount = resumePlan.retryExhaustedCount;
    let skippedCount = resumePlan.skippedCount;
    let failedCount = resumePlan.failedCount;

    await assertAuthenticatedYouTubeSession(session.page, ctx.config, "repair.start", { navigate: true });
    const target = await resolveTargetPlaylistForSavePanel(session.page, ctx.config.youtubeBaseUrl, targetRequest);
    const resolvedTargetPlaylist = target.title;

    for (const [index, item] of resumePlan.remainingItems.entries()) {
      const policy = assessSourceItemPolicy(item);
      if (policy.policy !== "copyable") {
        appendRepairOperation(operationsPath, {
          sourceIndex: item.sourceIndex,
          title: item.title,
          videoId: item.videoId,
          videoUrl: item.videoUrl,
          result: `skipped-${policy.policy}`,
          attempts: 1,
          error: policy.reason,
          timestamp: new Date().toISOString()
        });
        policySkippedCount += 1;
        skippedCount += 1;
      } else {
        try {
          const videoUrl = item.videoUrl;
          if (!videoUrl) {
            throw new Error(`Repair candidate '${item.sourceIndex}' is missing a videoUrl`);
          }

          const { result: response, attempts } = await runWithRetries({
            policy: retryPolicy,
            run: async () => {
              await assertAuthenticatedYouTubeSession(session.page, ctx.config, `repair.item.${item.sourceIndex}.before`);
              try {
                const response = await ensureVideoSavedToPlaylist(session.page, videoUrl, target, async () => {
                  await assertAuthenticatedYouTubeSession(session.page, ctx.config, `repair.item.${item.sourceIndex}.open-save-panel`);
                });
                await assertAuthenticatedYouTubeSession(session.page, ctx.config, `repair.item.${item.sourceIndex}.after`);
                return response;
              } catch (error) {
                await throwIfAuthenticationLost(session.page, ctx.config, `repair.item.${item.sourceIndex}.failure`, error);
                throw new Error("Authentication guard should have thrown before continuing");
              }
            },
            onRetry: async ({ attempt, nextAttempt, delayMs, error }) => {
              ctx.logEvent("repair", "warn", "repair.item-retry", "Retrying repair item after failure", {
                sourceIndex: item.sourceIndex,
                title: item.title,
                attempt,
                nextAttempt,
                delayMs,
                error: error.message,
                targetPlaylist: target.title,
                targetPlaylistId: target.playlistId ?? null
              });
            },
            sleep: async (delayMs) => {
              await session.page.waitForTimeout(delayMs);
            },
            shouldRetry: (error) => !(error instanceof AuthenticationRequiredError)
          });
          appendRepairOperation(operationsPath, {
            sourceIndex: item.sourceIndex,
            title: item.title,
            videoId: item.videoId,
            videoUrl,
            result: response.result,
            attempts,
            timings: response.timings,
            timestamp: new Date().toISOString()
          });
          if (response.result === "saved" || response.result === "already-saved") {
            repairedCount += 1;
            if (response.result === "saved") {
              savedCount += 1;
            } else {
              alreadySavedCount += 1;
            }
          }
        } catch (error) {
          if (error instanceof AuthenticationRequiredError) {
            const completedCount = resumePlan.processedCount + index;
            pauseRunForAuthentication({
              ctx,
              phase: "repair",
              error,
              payload: {
                verificationPath,
                sourceSnapshotRunId: sourceSnapshot.runId,
                targetPlaylist: resolvedTargetPlaylist,
                targetPlaylistId,
                processed: completedCount,
                total: repairItems.length,
                repairedCount,
                savedCount,
                alreadySavedCount,
                policySkippedCount,
                retryExhaustedCount,
                skippedCount,
                failedCount
              }
            });
            return;
          }

          const message = error instanceof Error ? error.message : String(error);
          const screenshotPath = path.join(ctx.artifacts.screenshotsDir, `repair-failure-${item.sourceIndex}.png`);
          await session.page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
          appendRepairOperation(operationsPath, {
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
          ctx.logEvent("repair", "error", "repair.item-failed", "Repair item failed", {
            sourceIndex: item.sourceIndex,
            title: item.title,
            error: message,
            attempts: retryPolicy.maxAttempts,
            ...(fs.existsSync(screenshotPath) ? { screenshotPath } : {}),
            targetPlaylist: resolvedTargetPlaylist,
            targetPlaylistId
          });
        }
      }

      const processedCount = resumePlan.processedCount + index + 1;
      if (processedCount % milestoneEvery === 0 || processedCount === repairItems.length) {
        ctx.logEvent("repair", "info", "repair.progress", "Repair progress milestone", {
          processed: processedCount,
          total: repairItems.length,
          repairedCount,
          savedCount,
          alreadySavedCount,
          policySkippedCount,
          retryExhaustedCount,
          skippedCount,
          failedCount,
          targetPlaylist: resolvedTargetPlaylist,
          targetPlaylistId
        });
      }

      ctx.saveCheckpoint("repair", {
        verificationPath,
        sourceSnapshotRunId: sourceSnapshot.runId,
        targetPlaylist: resolvedTargetPlaylist,
        targetPlaylistId,
        processed: processedCount,
        total: repairItems.length,
        repairedCount,
        savedCount,
        alreadySavedCount,
        policySkippedCount,
        retryExhaustedCount,
        skippedCount,
        failedCount
      });

      const pacingDelay = computeMutationPacingDelay(pacingPolicy, processedCount);
      if (pacingDelay.totalDelayMs > 0 && processedCount < repairItems.length) {
        ctx.logEvent("repair", "info", "repair.pacing", "Sleeping between repair items to throttle the mutation rate", {
          processedCount,
          jitterMs: pacingDelay.jitterMs,
          cooldownMs: pacingDelay.cooldownMs,
          totalDelayMs: pacingDelay.totalDelayMs,
          targetPlaylist: resolvedTargetPlaylist,
          targetPlaylistId
        });
        await session.page.waitForTimeout(pacingDelay.totalDelayMs);
      }
    }

    ctx.logEvent("repair", "info", "repair.complete", "Repair pass completed", {
      verificationPath,
      sourceSnapshotRunId: sourceSnapshot.runId,
      targetPlaylist: resolvedTargetPlaylist,
      targetPlaylistId,
      total: repairItems.length,
      repairedCount,
      savedCount,
      alreadySavedCount,
      policySkippedCount,
      retryExhaustedCount,
      skippedCount,
      failedCount,
      operationsPath
    });
    ctx.db.upsertRunState("repair", "complete");
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      pauseRunForAuthentication({
        ctx,
        phase: "repair",
        error,
        payload: {
          verificationPath,
          sourceSnapshotRunId: sourceSnapshot.runId,
          targetPlaylist,
          targetPlaylistId,
          processed: resumePlan.processedCount,
          total: repairItems.length,
          repairedCount: resumePlan.repairedCount,
          savedCount: resumePlan.savedCount,
          alreadySavedCount: resumePlan.alreadySavedCount,
          policySkippedCount: resumePlan.policySkippedCount,
          retryExhaustedCount: resumePlan.retryExhaustedCount,
          skippedCount: resumePlan.skippedCount,
          failedCount: resumePlan.failedCount
        }
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    ctx.logEvent("repair", "error", "repair.failed", "Repair pass failed", {
      error: message,
      verificationPath,
      targetPlaylist,
      targetPlaylistId
    });
    ctx.db.upsertRunState("repair", "failed");
    throw error;
  } finally {
    await session.close();
  }
}
