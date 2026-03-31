import fs from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { launchBrowserSession } from "../browser/launch.js";
import { resolvePlaylistPageUrlByName } from "../browser/youtube/playlistDiscovery.js";
import { openWatchLaterForDeletion, removeTopWatchLaterItem, getWatchLaterRowCount } from "../browser/youtube/removeFromWatchLater.js";
import { ensureVideoSavedToPlaylist } from "../browser/youtube/saveToPlaylist.js";
import type { SaveToPlaylistTimings } from "../browser/youtube/saveToPlaylist.js";
import type { InventoryItem } from "../models/types.js";
import { AuthenticationRequiredError, assertAuthenticatedYouTubeSession, throwIfAuthenticationLost } from "../services/authGuard.js";
import { pauseRunForAuthentication } from "../services/authPause.js";
import { buildChunkedMoveAppPayload } from "../services/appContracts.js";
import { readCheckpointFile } from "../services/checkpointFile.js";
import { sliceIntoChunks, planChunkedMoveResume } from "../services/chunkPlanner.js";
import type { ChunkedMoveChunkPhase } from "../services/chunkPlanner.js";
import { verifyChunkInTargetPlaylist } from "../services/chunkVerifier.js";
import { computeMutationPacingDelay, resolveMutationPacingPolicy, resolveMutationRetryPolicy, runWithRetries } from "../services/mutation.js";
import { assertUsableSourceSnapshot, readSourceSnapshot, resolveSourceSnapshotPath, selectSourceItems, assessSourceItemPolicy, partitionSourceItems } from "../services/sourceSnapshot.js";
import { getTargetPlaylistRequest, resolveTargetPlaylistForSavePanel } from "../services/targetPlaylist.js";
import { parsePositiveInt } from "../utils/cli.js";

const PHASE = "chunked-move" as const;

function formatRate(processedCount: number, startedAtMs: number): number {
  const elapsedSeconds = Math.max((Date.now() - startedAtMs) / 1000, 1);
  return Number((processedCount / elapsedSeconds).toFixed(2));
}

function appendOperation(
  operationsPath: string,
  entry: Record<string, unknown>
): void {
  fs.appendFileSync(operationsPath, `${JSON.stringify(entry)}\n`);
}

export async function runChunkedMove(command: Command): Promise<void> {
  const ctx = createRunContext(command, PHASE);
  const localOptions = command.opts<{
    targetPlaylist?: string;
    targetPlaylistId?: string;
    sourceRunId?: string;
    chunkSize?: string;
    startIndex?: string;
    maxItems?: string;
    interChunkCooldownMs?: string;
    resume?: boolean;
    confirmDelete?: boolean;
    json?: boolean;
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
  const chunkSize = parsePositiveInt(localOptions.chunkSize, 50);
  const startIndex = localOptions.startIndex ? parsePositiveInt(localOptions.startIndex, 1) : 1;
  const interChunkCooldownMs = parsePositiveInt(localOptions.interChunkCooldownMs, 60_000);
  const confirmDelete = localOptions.confirmDelete === true;
  const emitJson = localOptions.json === true;
  const retryPolicy = resolveMutationRetryPolicy(localOptions);
  const pacingPolicy = resolveMutationPacingPolicy(localOptions);
  const operationsPath = path.join(ctx.artifacts.runDir, "chunked-operations.jsonl");
  const startedAtMs = Date.now();

  const snapshotPath = resolveSourceSnapshotPath(ctx.rootDir, ctx.runId, localOptions.sourceRunId);
  const sourceSnapshot = readSourceSnapshot(snapshotPath);
  const allSourceItems = selectSourceItems(sourceSnapshot.items, {
    startIndex,
    ...(localOptions.maxItems ? { maxItems: parsePositiveInt(localOptions.maxItems, 0) } : {})
  });
  assertUsableSourceSnapshot(sourceSnapshot, allSourceItems.length);

  const chunks = sliceIntoChunks(allSourceItems, chunkSize);
  const totalChunks = chunks.length;
  const totalItems = allSourceItems.length;

  const resumePlan = localOptions.resume
    ? planChunkedMoveResume({
        checkpoint: readCheckpointFile(ctx.artifacts.checkpointPath),
        chunks,
        sourceSnapshotRunId: sourceSnapshot.runId,
        targetPlaylist
      })
    : {
        resumed: false,
        completedChunks: 0,
        currentChunkIndex: 0,
        currentChunkPhase: "copy" as ChunkedMoveChunkPhase,
        currentChunkCopyProcessed: 0,
        currentChunkDeleteProcessed: 0,
        savedCount: 0,
        alreadySavedCount: 0,
        expectedNonCopyableCount: 0,
        ambiguousBlockedCount: 0,
        removedCount: 0,
        retryExhaustedCount: 0,
        skippedCount: 0,
        failedCount: 0
      };

  if (resumePlan.currentChunkIndex >= totalChunks) {
    ctx.logEvent(PHASE, "info", "chunked-move.already-complete", "All chunks already completed", {
      totalChunks,
      totalItems
    });
    ctx.db.upsertRunState(PHASE, "complete");
    return;
  }

  ctx.logEvent(PHASE, "info", "chunked-move.started", "Chunked move started", {
    sourceSnapshotRunId: sourceSnapshot.runId,
    sourceSnapshotPath: snapshotPath,
    startIndex,
    totalItems,
    chunkSize,
    totalChunks,
    confirmDelete,
    resumed: resumePlan.resumed,
    resumeChunkIndex: resumePlan.currentChunkIndex,
    resumeChunkPhase: resumePlan.currentChunkPhase,
    retryPolicy,
    pacingPolicy,
    interChunkCooldownMs
  });

  if (emitJson) {
    emitJsonLine(ctx.runId, {
      type: "started",
      totalItems,
      chunkSize,
      totalChunks,
      confirmDelete,
      resumed: resumePlan.resumed
    });
  }

  let savedCount = resumePlan.savedCount;
  let alreadySavedCount = resumePlan.alreadySavedCount;
  let expectedNonCopyableCount = resumePlan.expectedNonCopyableCount;
  let ambiguousBlockedCount = resumePlan.ambiguousBlockedCount;
  let removedCount = resumePlan.removedCount;
  let retryExhaustedCount = resumePlan.retryExhaustedCount;
  let skippedCount = resumePlan.skippedCount;
  let failedCount = resumePlan.failedCount;
  let completedChunks = resumePlan.completedChunks;

  const session = await launchBrowserSession(ctx.config);

  try {
    await assertAuthenticatedYouTubeSession(session.page, ctx.config, "chunked-move.start", { navigate: true });
    const target = await resolveTargetPlaylistForSavePanel(session.page, ctx.config.youtubeBaseUrl, targetRequest);
    const resolvedTargetPlaylist = target.title;

    const targetPlaylistUrl = await resolvePlaylistPageUrlByName(
      session.page,
      ctx.config.youtubeBaseUrl,
      resolvedTargetPlaylist
    );
    if (!targetPlaylistUrl) {
      throw new Error(`Could not resolve playlist URL for '${resolvedTargetPlaylist}' — run setup first`);
    }

    const watchLaterUrl = `${ctx.config.youtubeBaseUrl}/playlist?list=WL`;

    // Cumulative mutation counter for pacing across the entire run
    let globalMutationCount = resumePlan.savedCount + resumePlan.alreadySavedCount + resumePlan.removedCount;

    for (let chunkIndex = resumePlan.currentChunkIndex; chunkIndex < totalChunks; chunkIndex++) {
      const chunk = chunks[chunkIndex]!;
      const chunkStartSourceIndex = chunk[0]?.sourceIndex ?? 0;
      const chunkEndSourceIndex = chunk[chunk.length - 1]?.sourceIndex ?? 0;

      const shouldResumeMidChunk = resumePlan.resumed && chunkIndex === resumePlan.currentChunkIndex;
      let chunkPhase: ChunkedMoveChunkPhase = shouldResumeMidChunk ? resumePlan.currentChunkPhase : "copy";
      let chunkCopyProcessed = shouldResumeMidChunk ? resumePlan.currentChunkCopyProcessed : 0;
      let chunkDeleteProcessed = shouldResumeMidChunk ? resumePlan.currentChunkDeleteProcessed : 0;
      let chunkCopyClean = true; // Track whether any copy failures occurred in this chunk

      ctx.logEvent(PHASE, "info", "chunked-move.chunk-started", "Starting chunk", {
        chunkIndex,
        chunkSize: chunk.length,
        startSourceIndex: chunkStartSourceIndex,
        endSourceIndex: chunkEndSourceIndex,
        chunkPhase,
        resumed: shouldResumeMidChunk
      });

      if (emitJson) {
        emitJsonLine(ctx.runId, {
          type: "chunk",
          chunkIndex,
          status: "started",
          startSourceIndex: chunkStartSourceIndex,
          endSourceIndex: chunkEndSourceIndex
        });
      }

      // ─── COPY PHASE ─────────────────────────────────────────
      if (chunkPhase === "copy") {
        const copyStartIndex = chunkCopyProcessed;
        for (let i = copyStartIndex; i < chunk.length; i++) {
          const item = chunk[i]!;
          const policy = assessSourceItemPolicy(item);

          if (policy.policy === "expected-non-copyable") {
            appendOperation(operationsPath, {
              phase: "copy",
              chunkIndex,
              sourceIndex: item.sourceIndex,
              title: item.title,
              videoId: item.videoId,
              result: "expected-non-copyable",
              reason: policy.reason,
              timestamp: new Date().toISOString()
            });
            expectedNonCopyableCount += 1;
            skippedCount += 1;
            chunkCopyProcessed = i + 1;
            saveCheckpoint(chunkIndex, "copy", chunkCopyProcessed, chunkDeleteProcessed);
            continue;
          }

          if (policy.policy === "ambiguous-unavailable") {
            appendOperation(operationsPath, {
              phase: "copy",
              chunkIndex,
              sourceIndex: item.sourceIndex,
              title: item.title,
              videoId: item.videoId,
              result: "ambiguous-source-item",
              reason: policy.reason,
              timestamp: new Date().toISOString()
            });
            ambiguousBlockedCount += 1;
            failedCount += 1;
            chunkCopyClean = false;
            chunkCopyProcessed = i + 1;
            saveCheckpoint(chunkIndex, "copy", chunkCopyProcessed, chunkDeleteProcessed);
            continue;
          }

          const videoUrl = item.videoUrl;
          if (!videoUrl) {
            throw new Error(`Copyable source item '${item.sourceIndex}' is missing a videoUrl`);
          }

          try {
            const { result: response, attempts } = await runWithRetries({
              policy: retryPolicy,
              run: async () => {
                // Periodic auth check every 10 items (open-panel check always runs)
                if (i % 10 === 0) {
                  await assertAuthenticatedYouTubeSession(session.page, ctx.config, `chunk.${chunkIndex}.copy.${item.sourceIndex}.periodic`);
                }
                try {
                  const resp = await ensureVideoSavedToPlaylist(session.page, videoUrl, target, async () => {
                    await assertAuthenticatedYouTubeSession(session.page, ctx.config, `chunk.${chunkIndex}.copy.${item.sourceIndex}.open-save-panel`);
                  }, { skipReopenConfirm: true });
                  return resp;
                } catch (error) {
                  await throwIfAuthenticationLost(session.page, ctx.config, `chunk.${chunkIndex}.copy.${item.sourceIndex}.failure`, error);
                  throw new Error("Authentication guard should have thrown before continuing");
                }
              },
              onRetry: async ({ attempt, nextAttempt, delayMs, error }) => {
                ctx.logEvent(PHASE, "warn", "chunked-move.copy-retry", "Retrying copy item", {
                  chunkIndex,
                  sourceIndex: item.sourceIndex,
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

            appendOperation(operationsPath, {
              phase: "copy",
              chunkIndex,
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

            ctx.logEvent(PHASE, "info", "chunked-move.copy-item", "Copied item", {
              chunkIndex,
              sourceIndex: item.sourceIndex,
              title: item.title,
              result: response.result,
              attempts,
              timings: response.timings
            });

            if (response.result === "saved") {
              savedCount += 1;
            } else {
              alreadySavedCount += 1;
              skippedCount += 1;
            }
            globalMutationCount += 1;
          } catch (error) {
            if (error instanceof AuthenticationRequiredError) {
              pauseAndExit(chunkIndex, "copy", i, chunkDeleteProcessed, error);
              return;
            }

            const message = error instanceof Error ? error.message : String(error);
            const screenshotPath = path.join(ctx.artifacts.screenshotsDir, `copy-failure-chunk${chunkIndex}-${item.sourceIndex}.png`);
            await session.page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
            appendOperation(operationsPath, {
              phase: "copy",
              chunkIndex,
              sourceIndex: item.sourceIndex,
              title: item.title,
              videoId: item.videoId,
              result: "failed",
              attempts: retryPolicy.maxAttempts,
              error: message,
              ...(fs.existsSync(screenshotPath) ? { screenshotPath } : {}),
              timestamp: new Date().toISOString()
            });
            ctx.logEvent(PHASE, "error", "chunked-move.copy-failed", "Copy item failed", {
              chunkIndex,
              sourceIndex: item.sourceIndex,
              error: message,
              attempts: retryPolicy.maxAttempts
            });
            retryExhaustedCount += 1;
            failedCount += 1;
            chunkCopyClean = false;
          }

          chunkCopyProcessed = i + 1;
          saveCheckpoint(chunkIndex, "copy", chunkCopyProcessed, chunkDeleteProcessed);

          // Pacing between copy items
          const pacingDelay = computeMutationPacingDelay(pacingPolicy, globalMutationCount);
          if (pacingDelay.totalDelayMs > 0) {
            ctx.logEvent(PHASE, "info", "chunked-move.pacing", "Pacing delay", {
              chunkIndex,
              globalMutationCount,
              jitterMs: pacingDelay.jitterMs,
              cooldownMs: pacingDelay.cooldownMs,
              totalDelayMs: pacingDelay.totalDelayMs
            });
            await session.page.waitForTimeout(pacingDelay.totalDelayMs);
          }

          if (emitJson) {
            emitJsonLine(ctx.runId, {
              type: "item",
              phase: "copy",
              chunkIndex,
              sourceIndex: item.sourceIndex,
              result: "ok"
            });
          }
        }

        chunkPhase = "verify";
        saveCheckpoint(chunkIndex, "verify", chunkCopyProcessed, chunkDeleteProcessed);
      }

      // ─── VERIFY PHASE ───────────────────────────────────────
      if (chunkPhase === "verify") {
        if (chunkCopyClean) {
          ctx.logEvent(PHASE, "info", "chunked-move.verify-skipped", "Skipping verification — all copy items succeeded", {
            chunkIndex
          });

          appendOperation(operationsPath, {
            phase: "verify",
            chunkIndex,
            passed: true,
            skipped: true,
            reason: "copy-clean",
            timestamp: new Date().toISOString()
          });

          if (emitJson) {
            emitJsonLine(ctx.runId, {
              type: "chunk-phase",
              chunkIndex,
              phase: "verify",
              status: "skipped-clean"
            });
          }

          chunkPhase = "delete";
          saveCheckpoint(chunkIndex, "delete", chunkCopyProcessed, chunkDeleteProcessed);
        } else {
        const chunkCopyableItems = chunk.filter((item) => {
          const policy = assessSourceItemPolicy(item);
          return policy.policy === "copyable" && item.videoId;
        });

        // Determine how many items to scroll in the target playlist.
        // Recently copied items should be near the top, so bound scrolling.
        const totalCopiedSoFar = savedCount + alreadySavedCount;
        const maxScrollItems = Math.max(chunkSize * 3, Math.min(totalCopiedSoFar + chunkSize, 500));

        ctx.logEvent(PHASE, "info", "chunked-move.verify-started", "Verifying chunk in target playlist", {
          chunkIndex,
          copyableCount: chunkCopyableItems.length,
          maxScrollItems
        });

        const verificationResult = await verifyChunkInTargetPlaylist({
          page: session.page,
          targetPlaylistUrl,
          chunkCopyableItems,
          maxScrollItems,
          config: ctx.config,
          authLabel: `chunk.${chunkIndex}.verify`
        });

        ctx.logEvent(PHASE, "info", "chunked-move.verify-result", "Chunk verification result", {
          chunkIndex,
          passed: verificationResult.passed,
          matchedCount: verificationResult.matchedCount,
          checkedCount: verificationResult.checkedCount,
          missingVideoIds: verificationResult.missingVideoIds,
          targetItemsLoaded: verificationResult.targetItemsLoaded
        });

        appendOperation(operationsPath, {
          phase: "verify",
          chunkIndex,
          passed: verificationResult.passed,
          matchedCount: verificationResult.matchedCount,
          checkedCount: verificationResult.checkedCount,
          missingVideoIds: verificationResult.missingVideoIds,
          timestamp: new Date().toISOString()
        });

        if (emitJson) {
          emitJsonLine(ctx.runId, {
            type: "chunk-phase",
            chunkIndex,
            phase: "verify",
            status: verificationResult.passed ? "passed" : "failed",
            matchedCount: verificationResult.matchedCount,
            checkedCount: verificationResult.checkedCount
          });
        }

        if (!verificationResult.passed) {
          ctx.logEvent(PHASE, "error", "chunked-move.verify-failed", "Chunk verification failed — halting before delete", {
            chunkIndex,
            missingVideoIds: verificationResult.missingVideoIds
          });
          chunkPhase = "verify";
          saveCheckpoint(chunkIndex, "verify", chunkCopyProcessed, chunkDeleteProcessed);
          ctx.db.upsertRunState(PHASE, "failed");
          throw new Error(
            `Chunk ${chunkIndex} verification failed: ${verificationResult.missingVideoIds.length} items missing from target playlist. Run with --resume after investigating.`
          );
        }

        chunkPhase = "delete";
        saveCheckpoint(chunkIndex, "delete", chunkCopyProcessed, chunkDeleteProcessed);
        } // end else (not chunkCopyClean)
      }

      // ─── DELETE PHASE ────────────────────────────────────────
      if (chunkPhase === "delete") {
        if (!confirmDelete) {
          ctx.logEvent(PHASE, "info", "chunked-move.skip-delete", "Skipping delete — --confirm-delete not provided", {
            chunkIndex
          });
        } else {
          await openWatchLaterForDeletion(session.page, watchLaterUrl);
          const deleteStartIndex = chunkDeleteProcessed;

          for (let i = deleteStartIndex; i < chunk.length; i++) {
            const item = chunk[i]!;

            try {
              const { attempts } = await runWithRetries({
                policy: retryPolicy,
                run: async () => {
                  // Periodic auth check every 10 items
                  if (i % 10 === 0) {
                    await assertAuthenticatedYouTubeSession(session.page, ctx.config, `chunk.${chunkIndex}.delete.${item.sourceIndex}.periodic`);
                  }
                  await removeTopWatchLaterItem(session.page, item);
                },
                onRetry: async ({ attempt, nextAttempt, delayMs, error }) => {
                  ctx.logEvent(PHASE, "warn", "chunked-move.delete-retry", "Retrying delete item", {
                    chunkIndex,
                    sourceIndex: item.sourceIndex,
                    attempt,
                    nextAttempt,
                    delayMs,
                    error: error.message
                  });
                  // Re-navigate to WL after a failed deletion attempt
                  await openWatchLaterForDeletion(session.page, watchLaterUrl);
                },
                sleep: async (delayMs) => {
                  await session.page.waitForTimeout(delayMs);
                },
                shouldRetry: (error) => !(error instanceof AuthenticationRequiredError)
              });

              appendOperation(operationsPath, {
                phase: "delete",
                chunkIndex,
                sourceIndex: item.sourceIndex,
                title: item.title,
                videoId: item.videoId,
                result: "removed",
                attempts,
                timestamp: new Date().toISOString()
              });

              ctx.logEvent(PHASE, "info", "chunked-move.delete-item", "Deleted item", {
                chunkIndex,
                sourceIndex: item.sourceIndex,
                title: item.title,
                attempts
              });

              removedCount += 1;
              globalMutationCount += 1;
            } catch (error) {
              if (error instanceof AuthenticationRequiredError) {
                pauseAndExit(chunkIndex, "delete", chunkCopyProcessed, i, error);
                return;
              }

              const message = error instanceof Error ? error.message : String(error);
              ctx.logEvent(PHASE, "error", "chunked-move.delete-failed", "Delete item failed", {
                chunkIndex,
                sourceIndex: item.sourceIndex,
                error: message
              });
              // Delete failures are fatal for the chunk — ordering would be broken
              chunkDeleteProcessed = i;
              saveCheckpoint(chunkIndex, "delete", chunkCopyProcessed, chunkDeleteProcessed);
              ctx.db.upsertRunState(PHASE, "failed");
              throw error;
            }

            chunkDeleteProcessed = i + 1;
            saveCheckpoint(chunkIndex, "delete", chunkCopyProcessed, chunkDeleteProcessed);

            // Pacing between delete items
            const pacingDelay = computeMutationPacingDelay(pacingPolicy, globalMutationCount);
            if (pacingDelay.totalDelayMs > 0 && i < chunk.length - 1) {
              ctx.logEvent(PHASE, "info", "chunked-move.pacing", "Pacing delay", {
                chunkIndex,
                phase: "delete",
                globalMutationCount,
                jitterMs: pacingDelay.jitterMs,
                cooldownMs: pacingDelay.cooldownMs,
                totalDelayMs: pacingDelay.totalDelayMs
              });
              await session.page.waitForTimeout(pacingDelay.totalDelayMs);
            }

            if (emitJson) {
              emitJsonLine(ctx.runId, {
                type: "item",
                phase: "delete",
                chunkIndex,
                sourceIndex: item.sourceIndex,
                result: "removed"
              });
            }
          }
        }
      }

      // ─── CHUNK COMPLETE ──────────────────────────────────────
      completedChunks += 1;
      chunkPhase = "complete";
      saveCheckpoint(chunkIndex, "complete", chunkCopyProcessed, chunkDeleteProcessed);

      const totalProcessed = completedChunks * chunkSize;
      ctx.logEvent(PHASE, "info", "chunked-move.chunk-complete", "Chunk completed", {
        chunkIndex,
        completedChunks,
        totalChunks,
        savedCount,
        removedCount,
        totalProcessed: Math.min(totalProcessed, totalItems),
        totalItems,
        rateItemsPerSecond: formatRate(savedCount + alreadySavedCount, startedAtMs)
      });

      if (emitJson) {
        emitJsonLine(ctx.runId, {
          type: "chunk",
          chunkIndex,
          status: "completed",
          completedChunks,
          totalChunks,
          savedCount,
          removedCount
        });
      }

      // Inter-chunk cooldown (skip after the last chunk)
      if (chunkIndex < totalChunks - 1 && interChunkCooldownMs > 0) {
        ctx.logEvent(PHASE, "info", "chunked-move.inter-chunk-cooldown", "Cooling down between chunks", {
          chunkIndex,
          cooldownMs: interChunkCooldownMs
        });
        await session.page.waitForTimeout(interChunkCooldownMs);

        // Auth re-check before the next chunk
        try {
          await assertAuthenticatedYouTubeSession(session.page, ctx.config, `chunk.${chunkIndex}.post-cooldown`, { navigate: true });
        } catch (error) {
          if (error instanceof AuthenticationRequiredError) {
            pauseAndExit(chunkIndex + 1, "copy", 0, 0, error);
            return;
          }
          throw error;
        }
      }
    }

    // ─── RUN COMPLETE ────────────────────────────────────────
    const summary = {
      sourceSnapshotRunId: sourceSnapshot.runId,
      targetPlaylist: resolvedTargetPlaylist,
      totalItems,
      chunkSize,
      totalChunks,
      completedChunks,
      savedCount,
      alreadySavedCount,
      expectedNonCopyableCount,
      ambiguousBlockedCount,
      removedCount,
      retryExhaustedCount,
      skippedCount,
      failedCount,
      confirmDelete,
      rateItemsPerSecond: formatRate(savedCount + alreadySavedCount, startedAtMs)
    };

    fs.writeFileSync(
      path.join(ctx.artifacts.runDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`
    );

    ctx.logEvent(PHASE, "info", "chunked-move.complete", "Chunked move completed", summary);
    ctx.db.upsertRunState(PHASE, "complete");

    if (emitJson) {
      emitJsonLine(ctx.runId, { type: "result", ok: true, ...summary });
    }
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      // Already handled in pauseAndExit — this is a safety net
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    ctx.logEvent(PHASE, "error", "chunked-move.failed", "Chunked move failed", { error: message });
    ctx.db.upsertRunState(PHASE, "failed");

    if (emitJson) {
      emitJsonLine(ctx.runId, { type: "result", ok: false, error: message });
    }

    throw error;
  } finally {
    await session.close();
  }

  // ─── Inner helpers (closures over mutable state) ─────────
  function saveCheckpoint(
    chunkIndex: number,
    chunkPhase: ChunkedMoveChunkPhase,
    copyProcessed: number,
    deleteProcessed: number
  ): void {
    ctx.saveCheckpoint(PHASE, {
      sourceSnapshotRunId: sourceSnapshot.runId,
      targetPlaylist,
      targetPlaylistId: targetRequest.targetPlaylistId,
      chunkSize,
      completedChunks,
      totalChunks,
      currentChunkIndex: chunkIndex,
      currentChunkPhase: chunkPhase,
      currentChunkCopyProcessed: copyProcessed,
      currentChunkDeleteProcessed: deleteProcessed,
      totalProcessed: savedCount + alreadySavedCount + expectedNonCopyableCount + ambiguousBlockedCount,
      totalItems,
      savedCount,
      alreadySavedCount,
      expectedNonCopyableCount,
      ambiguousBlockedCount,
      removedCount,
      retryExhaustedCount,
      skippedCount,
      failedCount
    });
  }

  function pauseAndExit(
    chunkIndex: number,
    chunkPhase: ChunkedMoveChunkPhase,
    copyProcessed: number,
    deleteProcessed: number,
    error: AuthenticationRequiredError
  ): void {
    pauseRunForAuthentication({
      ctx,
      phase: PHASE,
      error,
      payload: {
        sourceSnapshotRunId: sourceSnapshot.runId,
        targetPlaylist,
        targetPlaylistId: targetRequest.targetPlaylistId,
        chunkSize,
        completedChunks,
        totalChunks,
        currentChunkIndex: chunkIndex,
        currentChunkPhase: chunkPhase,
        currentChunkCopyProcessed: copyProcessed,
        currentChunkDeleteProcessed: deleteProcessed,
        totalProcessed: savedCount + alreadySavedCount + expectedNonCopyableCount + ambiguousBlockedCount,
        totalItems,
        savedCount,
        alreadySavedCount,
        expectedNonCopyableCount,
        ambiguousBlockedCount,
        removedCount,
        retryExhaustedCount,
        skippedCount,
        failedCount
      }
    });
  }
}

function emitJsonLine(runId: string, payload: Record<string, unknown>): void {
  const envelope = buildChunkedMoveAppPayload(runId, payload);
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}
