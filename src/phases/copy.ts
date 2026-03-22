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
import { computeMutationPacingDelay, resolveMutationPacingPolicy, resolveMutationRetryPolicy, runWithRetries } from "../services/mutation.js";
import { planCopyResume } from "../services/resumePlanner.js";
import { assertUsableSourceSnapshot, readSourceSnapshot, resolveSourceSnapshotPath, selectSourceItems, assessSourceItemPolicy, partitionSourceItems } from "../services/sourceSnapshot.js";
import { getTargetPlaylistRequest, resolveTargetPlaylistForSavePanel } from "../services/targetPlaylist.js";
import { parsePositiveInt } from "../utils/cli.js";

function formatRate(processedCount: number, startedAtMs: number): number {
  const elapsedSeconds = Math.max((Date.now() - startedAtMs) / 1000, 1);
  return Number((processedCount / elapsedSeconds).toFixed(2));
}

function appendCopyOperation(
  operationsPath: string,
  entry: {
    sourceIndex: number;
    title: string | null;
    channelName: string | null;
    videoId: string | null;
    videoUrl: string | null;
    result: string;
    attempts: number;
    timings?: SaveToPlaylistTimings;
    error?: string;
    screenshotPath?: string;
    timestamp: string;
  }
): void {
  fs.appendFileSync(operationsPath, `${JSON.stringify(entry)}\n`);
}

export async function runCopy(command: Command): Promise<void> {
  const ctx = createRunContext(command, "copy");
  const localOptions = command.opts<{
    maxItems?: string;
    targetPlaylist?: string;
    targetPlaylistId?: string;
    milestoneEvery?: string;
    sourceRunId?: string;
    startIndex?: string;
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
  const operationsPath = path.join(ctx.artifacts.runDir, "copy-operations.jsonl");
  const startedAtMs = Date.now();
  const snapshotPath = resolveSourceSnapshotPath(ctx.rootDir, ctx.runId, localOptions.sourceRunId);
  const sourceSnapshot = readSourceSnapshot(snapshotPath);
  const startIndex = localOptions.startIndex ? parsePositiveInt(localOptions.startIndex, 1) : 1;
  const sourceItems = selectSourceItems(sourceSnapshot.items, {
    startIndex,
    ...(localOptions.maxItems ? { maxItems: parsePositiveInt(localOptions.maxItems, 0) } : {})
  });
  assertUsableSourceSnapshot(sourceSnapshot, sourceItems.length);
  const resumePlan = localOptions.resume
    ? planCopyResume({
        checkpoint: readCheckpointFile(ctx.artifacts.checkpointPath),
        sourceItems,
        sourceSnapshotRunId: sourceSnapshot.runId,
        targetPlaylist
      })
    : {
        resumed: false,
        processedCount: 0,
        lastProcessedSourceIndex: 0,
        remainingItems: sourceItems,
        savedCount: 0,
        alreadySavedCount: 0,
        expectedNonCopyableCount: 0,
        ambiguousBlockedCount: 0,
        retryExhaustedCount: 0,
        skippedCount: 0,
        failedCount: 0
      };

  const session = await launchBrowserSession(ctx.config);

  try {
    ctx.logEvent("copy", "info", "copy.source-snapshot", "Loaded source snapshot", {
      sourceSnapshotRunId: sourceSnapshot.runId,
        sourceSnapshotPath: snapshotPath,
        startIndex,
        sourceTotal: sourceSnapshot.total,
        selectedCount: sourceItems.length,
      sourceFingerprint: sourceSnapshot.fingerprint,
      resumed: resumePlan.resumed,
      resumeProcessedCount: resumePlan.processedCount,
      retryPolicy,
      pacingPolicy
    });
    const partitionedSource = partitionSourceItems(sourceItems);
    ctx.logEvent("copy", "info", "copy.source-policy", "Assessed source item copy policy", {
      copyableCount: partitionedSource.copyableItems.length,
      expectedNonCopyableCount: partitionedSource.expectedNonCopyableItems.length,
      ambiguousCount: partitionedSource.ambiguousItems.length,
      sourceSnapshotRunId: sourceSnapshot.runId
    });
    let savedCount = resumePlan.savedCount;
    let alreadySavedCount = resumePlan.alreadySavedCount;
    let expectedNonCopyableCount = resumePlan.expectedNonCopyableCount;
    let ambiguousBlockedCount = resumePlan.ambiguousBlockedCount;
    let retryExhaustedCount = resumePlan.retryExhaustedCount;
    let skippedCount = resumePlan.skippedCount;
    let failedCount = resumePlan.failedCount;

    await assertAuthenticatedYouTubeSession(session.page, ctx.config, "copy.start", { navigate: true });
    const target = await resolveTargetPlaylistForSavePanel(session.page, ctx.config.youtubeBaseUrl, targetRequest);
    const resolvedTargetPlaylist = target.title;

    for (const [index, item] of resumePlan.remainingItems.entries()) {
      try {
        await processCopyItem({
          ctx,
          item,
          page: session.page,
          target,
          operationsPath,
          retryPolicy,
          onSaved: () => {
            savedCount += 1;
          },
          onAlreadySaved: () => {
            alreadySavedCount += 1;
            skippedCount += 1;
          },
          onExpectedNonCopyable: () => {
            expectedNonCopyableCount += 1;
            skippedCount += 1;
          },
          onAmbiguousBlocked: () => {
            ambiguousBlockedCount += 1;
            failedCount += 1;
          },
          onRetryExhausted: () => {
            retryExhaustedCount += 1;
            failedCount += 1;
          }
        });
      } catch (error) {
        if (error instanceof AuthenticationRequiredError) {
          const completedCount = resumePlan.processedCount + index;
          pauseRunForAuthentication({
            ctx,
            phase: "copy",
            error,
            payload: {
              targetPlaylist: resolvedTargetPlaylist,
              targetPlaylistId,
              sourceSnapshotRunId: sourceSnapshot.runId,
              sourceSnapshotPath: snapshotPath,
              startIndex,
              processed: completedCount,
              processedCount: completedCount,
              lastProcessedSourceIndex: completedCount > 0 ? sourceItems[completedCount - 1]?.sourceIndex ?? 0 : 0,
              total: sourceItems.length,
              savedCount,
              alreadySavedCount,
              expectedNonCopyableCount,
              ambiguousBlockedCount,
              retryExhaustedCount,
              skippedCount,
              failedCount
            }
          });
          return;
        }

        throw error;
      }

      const processedCount = resumePlan.processedCount + index + 1;
      if (processedCount % milestoneEvery === 0 || processedCount === sourceItems.length) {
        ctx.logEvent("copy", "info", "copy.progress", "Copy progress milestone", {
          processed: processedCount,
          processedCount,
          lastProcessedSourceIndex: item.sourceIndex,
          total: sourceItems.length,
          savedCount,
          alreadySavedCount,
          expectedNonCopyableCount,
          ambiguousBlockedCount,
          retryExhaustedCount,
          skippedCount,
          failedCount,
          rateItemsPerSecond: formatRate(processedCount, startedAtMs),
          targetPlaylist: resolvedTargetPlaylist,
          targetPlaylistId,
          sourceSnapshotRunId: sourceSnapshot.runId
        });
      }

      ctx.saveCheckpoint("copy", {
        targetPlaylist: resolvedTargetPlaylist,
        targetPlaylistId,
        sourceSnapshotRunId: sourceSnapshot.runId,
        startIndex,
        sourceSnapshotPath: snapshotPath,
        processed: processedCount,
        processedCount,
        lastProcessedSourceIndex: item.sourceIndex,
        total: sourceItems.length,
        savedCount,
        alreadySavedCount,
        expectedNonCopyableCount,
        ambiguousBlockedCount,
        retryExhaustedCount,
        skippedCount,
        failedCount
      });

      const pacingDelay = computeMutationPacingDelay(pacingPolicy, processedCount);
      if (pacingDelay.totalDelayMs > 0 && processedCount < sourceItems.length) {
        ctx.logEvent("copy", "info", "copy.pacing", "Sleeping between copy items to throttle the mutation rate", {
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

    ctx.logEvent("copy", "info", "copy.complete", "Copy pass completed", {
      targetPlaylist: resolvedTargetPlaylist,
      targetPlaylistId,
      total: sourceItems.length,
      savedCount,
      alreadySavedCount,
      expectedNonCopyableCount,
      ambiguousBlockedCount,
      retryExhaustedCount,
      skippedCount,
      failedCount,
      operationsPath,
      sourceSnapshotRunId: sourceSnapshot.runId,
      startIndex,
      sourceSnapshotPath: snapshotPath
    });
    ctx.db.upsertRunState("copy", "complete");
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      pauseRunForAuthentication({
        ctx,
        phase: "copy",
        error,
        payload: {
          targetPlaylist,
          targetPlaylistId,
          sourceSnapshotRunId: sourceSnapshot.runId,
          sourceSnapshotPath: snapshotPath,
          startIndex,
          processed: resumePlan.processedCount,
          processedCount: resumePlan.processedCount,
          lastProcessedSourceIndex: resumePlan.lastProcessedSourceIndex,
          total: sourceItems.length,
          savedCount: resumePlan.savedCount,
          alreadySavedCount: resumePlan.alreadySavedCount,
          expectedNonCopyableCount: resumePlan.expectedNonCopyableCount,
          ambiguousBlockedCount: resumePlan.ambiguousBlockedCount,
          retryExhaustedCount: resumePlan.retryExhaustedCount,
          skippedCount: resumePlan.skippedCount,
          failedCount: resumePlan.failedCount
        }
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    ctx.logEvent("copy", "error", "copy.failed", "Copy pass failed", { error: message, targetPlaylist, targetPlaylistId });
    ctx.db.upsertRunState("copy", "failed");
    throw error;
  } finally {
    await session.close();
  }
}

async function processCopyItem(args: {
  ctx: ReturnType<typeof createRunContext>;
  item: InventoryItem;
  page: import("playwright").Page;
  target: import("../browser/youtube/saveToPlaylist.js").PlaylistTarget;
  operationsPath: string;
  retryPolicy: ReturnType<typeof resolveMutationRetryPolicy>;
  onSaved: () => void;
  onAlreadySaved: () => void;
  onExpectedNonCopyable: () => void;
  onAmbiguousBlocked: () => void;
  onRetryExhausted: () => void;
}): Promise<void> {
  const { ctx, item, page, target, operationsPath, onSaved } = args;

  const policy = assessSourceItemPolicy(item);
  if (policy.policy === "expected-non-copyable") {
    appendCopyOperation(operationsPath, {
      sourceIndex: item.sourceIndex,
      title: item.title,
      channelName: item.channelName,
      videoId: item.videoId,
      videoUrl: item.videoUrl,
      result: "expected-non-copyable",
      attempts: 1,
      error: policy.reason,
      timestamp: new Date().toISOString()
    });
    ctx.logEvent("copy", "warn", "copy.item-expected-non-copyable", "Skipped expected non-copyable item", {
      sourceIndex: item.sourceIndex,
      title: item.title,
      reason: policy.reason,
      targetPlaylist: target.title,
      targetPlaylistId: target.playlistId ?? null
    });
    args.onExpectedNonCopyable();
    return;
  }

  if (policy.policy === "ambiguous-unavailable") {
    appendCopyOperation(operationsPath, {
      sourceIndex: item.sourceIndex,
      title: item.title,
      channelName: item.channelName,
      videoId: item.videoId,
      videoUrl: item.videoUrl,
      result: "ambiguous-source-item",
      attempts: 1,
      error: policy.reason,
      timestamp: new Date().toISOString()
    });
    ctx.logEvent("copy", "error", "copy.item-ambiguous-source", "Source item is ambiguous and was not copied", {
      sourceIndex: item.sourceIndex,
      title: item.title,
      reason: policy.reason,
      targetPlaylist: target.title,
      targetPlaylistId: target.playlistId ?? null
    });
    args.onAmbiguousBlocked();
    return;
  }

  try {
    const videoUrl = item.videoUrl;
    if (!videoUrl) {
      throw new Error(`Copyable source item '${item.sourceIndex}' is missing a videoUrl`);
    }

    const { result: response, attempts } = await runWithRetries({
      policy: args.retryPolicy,
      run: async () => {
        await assertAuthenticatedYouTubeSession(page, ctx.config, `copy.item.${item.sourceIndex}.before`);
        try {
          const response = await ensureVideoSavedToPlaylist(page, videoUrl, target, async () => {
            await assertAuthenticatedYouTubeSession(page, ctx.config, `copy.item.${item.sourceIndex}.open-save-panel`);
          });
          await assertAuthenticatedYouTubeSession(page, ctx.config, `copy.item.${item.sourceIndex}.after`);
          return response;
              } catch (error) {
                await throwIfAuthenticationLost(page, ctx.config, `copy.item.${item.sourceIndex}.failure`, error);
                throw new Error("Authentication guard should have thrown before continuing");
              }
            },
      onRetry: async ({ attempt, nextAttempt, delayMs, error }) => {
        ctx.logEvent("copy", "warn", "copy.item-retry", "Retrying copy item after failure", {
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
        await page.waitForTimeout(delayMs);
      },
      shouldRetry: (error) => !(error instanceof AuthenticationRequiredError)
    });
    appendCopyOperation(operationsPath, {
      sourceIndex: item.sourceIndex,
      title: item.title,
      channelName: item.channelName,
      videoId: item.videoId,
      videoUrl,
      result: response.result,
      attempts,
      timings: response.timings,
      timestamp: new Date().toISOString()
    });

    ctx.logEvent("copy", "info", "copy.item", "Processed copy item", {
      sourceIndex: item.sourceIndex,
      title: item.title,
      result: response.result,
      attempts,
      timings: response.timings,
      targetPlaylist: target.title,
      targetPlaylistId: target.playlistId ?? null
    });

    if (response.result === "saved") {
      onSaved();
    } else {
      args.onAlreadySaved();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const screenshotPath = path.join(ctx.artifacts.screenshotsDir, `copy-failure-${item.sourceIndex}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
    appendCopyOperation(operationsPath, {
      sourceIndex: item.sourceIndex,
      title: item.title,
      channelName: item.channelName,
      videoId: item.videoId,
      videoUrl: item.videoUrl,
      result: "failed",
      attempts: args.retryPolicy.maxAttempts,
      error: message,
      ...(fs.existsSync(screenshotPath) ? { screenshotPath } : {}),
      timestamp: new Date().toISOString()
    });
    ctx.logEvent("copy", "error", "copy.item-failed", "Copy item failed", {
      sourceIndex: item.sourceIndex,
      title: item.title,
      error: message,
      attempts: args.retryPolicy.maxAttempts,
      ...(fs.existsSync(screenshotPath) ? { screenshotPath } : {}),
      targetPlaylist: target.title,
      targetPlaylistId: target.playlistId ?? null
    });
    args.onRetryExhausted();
  }
}
