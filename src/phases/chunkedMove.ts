import fs from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { launchBrowserSession } from "../browser/launch.js";
import { resolvePlaylistPageUrlByName } from "../browser/youtube/playlistDiscovery.js";
import { loadWatchLaterInventory } from "../browser/youtube/inventory.js";
import { openWatchLaterForDeletion, removeTopWatchLaterItemUnvalidated, getWatchLaterRowCount } from "../browser/youtube/removeFromWatchLater.js";
import { openWatchLaterForSaving, saveWatchLaterItemByIndex } from "../browser/youtube/saveFromPlaylistPage.js";
import type { InventoryItem } from "../models/types.js";
import { AuthenticationRequiredError, assertAuthenticatedYouTubeSession } from "../services/authGuard.js";
import { pauseRunForAuthentication } from "../services/authPause.js";
import { buildMoveAppPayload } from "../services/appContracts.js";
import { readCheckpointFile } from "../services/checkpointFile.js";
import { sliceIntoChunks, planChunkedMoveResume } from "../services/chunkPlanner.js";
import type { ChunkedMoveChunkPhase } from "../services/chunkPlanner.js";
import { verifyChunkInTargetPlaylist } from "../services/chunkVerifier.js";
import { computeMutationPacingDelay, resolveMutationPacingPolicy, resolveMutationRetryPolicy, runWithRetries } from "../services/mutation.js";
import { assertUsableSourceSnapshot, computeInventoryFingerprint, readSourceSnapshot, resolveSourceSnapshotPath, selectSourceItems, assessSourceItemPolicy } from "../services/sourceSnapshot.js";
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
  const localOpts = command.opts<{ json?: boolean }>();
  const json = Boolean(localOpts.json);
  const ctx = createRunContext(command, PHASE, json ? { consoleStream: process.stderr } : {});
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

  // Single browser session for the entire run
  ctx.logEvent(PHASE, "info", "chunked-move.launching-browser", "Connecting to browser...", {});
  const session = await launchBrowserSession(ctx.config);
  ctx.logEvent(PHASE, "info", "chunked-move.browser-connected", "Browser connected", {});

  try {
    ctx.logEvent(PHASE, "info", "chunked-move.auth-check", "Checking authentication...", {});
    // Quick auth check: just look for the account button on the current page.
    // Skip navigation and networkidle — YouTube never reaches network idle.
    const currentUrl = session.page.url();
    if (!currentUrl.includes("youtube.com")) {
      await session.page.goto(ctx.config.youtubeBaseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    }
    await session.page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
    const accountBtn = session.page.locator("button#avatar-btn, button[aria-label*='Google Account'], button[aria-label*='Account menu']");
    const signedIn = await accountBtn.count().catch(() => 0);
    if (!signedIn) {
      throw new AuthenticationRequiredError({
        snapshot: { signedIn: false, accountLabel: null, currentUrl, pageTitle: "" },
        reason: "not-signed-in-to-youtube",
        contextLabel: "chunked-move.start"
      });
    }
    ctx.logEvent(PHASE, "info", "chunked-move.auth-ok", "Authentication verified", {});

    // Resolve the target playlist once (navigates to playlists feed)
    ctx.logEvent(PHASE, "info", "chunked-move.resolving-playlist", "Resolving target playlist...", {});
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

    // If no source snapshot is provided, capture a fresh inventory using the same session
    let snapshotPath: string;
    if (localOptions.sourceRunId) {
      snapshotPath = resolveSourceSnapshotPath(ctx.rootDir, ctx.runId, localOptions.sourceRunId);
    } else {
      ctx.logEvent(PHASE, "info", "chunked-move.inventory-start", "Capturing fresh Watch Later inventory", {});
      if (emitJson) {
        emitJsonLine(ctx.runId, { type: "phase", phase: "inventory", status: "started" });
      }

      const inventoryResult = await loadWatchLaterInventory(session.page, watchLaterUrl, {
        maxNoGrowthPasses: 3,
        settleMs: 1500,
        onScrollPass: ({ pass, rowCount }) => {
          ctx.logEvent(PHASE, "info", "chunked-move.inventory-scroll", `Scanning: ${rowCount} videos found`, {
            pass, rowCount
          });
          if (emitJson) {
            emitJsonLine(ctx.runId, {
              type: "progress",
              phase: "inventory",
              completed: rowCount,
              total: 0,
              message: `Scanning Watch Later: ${rowCount} videos found`
            });
          }
        }
      });

      const fingerprint = computeInventoryFingerprint(inventoryResult.items);
      snapshotPath = path.join(ctx.artifacts.runDir, "inventory.json");
      fs.writeFileSync(snapshotPath, `${JSON.stringify({
        currentUrl: session.page.url(),
        capturedAt: new Date().toISOString(),
        metadataVersion: 1,
        total: inventoryResult.items.length,
        scrollPasses: inventoryResult.scrollPasses,
        requestedMaxItems: null,
        bounded: false,
        fingerprint,
        items: inventoryResult.items
      }, null, 2)}\n`);

      ctx.logEvent(PHASE, "info", "chunked-move.inventory-complete", `Inventory captured: ${inventoryResult.items.length} videos`, {
        total: inventoryResult.items.length,
        scrollPasses: inventoryResult.scrollPasses
      });
      if (emitJson) {
        emitJsonLine(ctx.runId, { type: "phase", phase: "inventory", status: "completed" });
      }
    }

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
        runId: ctx.runId,
        targetPlaylist,
        workflow: {
          workflowRunId: ctx.runId,
          verifyRunId: `${ctx.runId}-verify`,
          deleteRunId: `${ctx.runId}-delete`
        }
      });
      if (!localOptions.sourceRunId) {
        // Inventory was already emitted above
      } else {
        emitJsonLine(ctx.runId, { type: "phase", phase: "inventory", status: "completed" });
      }
      emitJsonLine(ctx.runId, { type: "phase", phase: "copy", status: "started" });
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

    // Cumulative mutation counter for pacing across the entire run
    let globalMutationCount = resumePlan.savedCount + resumePlan.alreadySavedCount + resumePlan.removedCount;

    // Throttle detection: track recent copy durations
    const recentDurations: number[] = [];
    const THROTTLE_WINDOW = 20;
    const THROTTLE_THRESHOLD_MS = 15_000; // warn if avg exceeds this

    // ─── Inner helpers (closures over mutable state) ─────────
    function saveCheckpoint(
      chunkIdx: number,
      chunkPh: ChunkedMoveChunkPhase,
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
        currentChunkIndex: chunkIdx,
        currentChunkPhase: chunkPh,
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
      chunkIdx: number,
      chunkPh: ChunkedMoveChunkPhase,
      copyProcessed: number,
      deleteProcessed: number,
      authError: AuthenticationRequiredError
    ): void {
      pauseRunForAuthentication({
        ctx,
        phase: PHASE,
        error: authError,
        payload: {
          sourceSnapshotRunId: sourceSnapshot.runId,
          targetPlaylist,
          targetPlaylistId: targetRequest.targetPlaylistId,
          chunkSize,
          completedChunks,
          totalChunks,
          currentChunkIndex: chunkIdx,
          currentChunkPhase: chunkPh,
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

      // (chunk-started is implicit — item events provide progress)

      // ─── COPY PHASE (from Watch Later playlist page) ────────
      if (chunkPhase === "copy") {
        // Force a fresh WL page load at the start of each chunk.
        // After delete, the DOM is stale — we need the updated row list.
        await session.page.goto(watchLaterUrl, { waitUntil: "domcontentloaded" });
        await session.page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
        await session.page.locator("ytd-playlist-video-renderer").first().waitFor({ state: "visible", timeout: 15_000 });

        // Row offset: prior chunks that were fully deleted shift the WL rows up.
        // If --confirm-delete is on, completed chunks had their items removed,
        // so the current chunk's items start at row 0. If delete is off, items
        // accumulate and we need to offset by undeleted prior chunks.
        const deletedPriorItems = confirmDelete ? completedChunks * chunkSize : 0;
        const chunkRowOffset = (chunkIndex * chunkSize) - deletedPriorItems;

        const copyStartIndex = chunkCopyProcessed;
        for (let i = copyStartIndex; i < chunk.length; i++) {
          const item = chunk[i]!;
          const rowIndex = chunkRowOffset + i;

          try {
            const { result: saveResult, attempts } = await runWithRetries({
              policy: retryPolicy,
              run: async () => {
                const resp = await saveWatchLaterItemByIndex(session.page, rowIndex, target);
                return resp;
              },
              onRetry: async ({ attempt, nextAttempt, delayMs, error }) => {
                ctx.logEvent(PHASE, "warn", "chunked-move.copy-retry", "Retrying copy item", {
                  chunkIndex, sourceIndex: item.sourceIndex, rowIndex,
                  attempt, nextAttempt, delayMs, error: error.message
                });
                // Re-navigate to WL page after failure
                await openWatchLaterForSaving(session.page, watchLaterUrl);
              },
              sleep: async (delayMs) => {
                await session.page.waitForTimeout(delayMs);
              },
              shouldRetry: (error) => !(error instanceof AuthenticationRequiredError)
            });

            const actualItem = saveResult.actualItem;
            appendOperation(operationsPath, {
              phase: "copy",
              chunkIndex,
              sourceIndex: item.sourceIndex,
              rowIndex,
              title: actualItem.title,
              channelName: actualItem.channelName,
              videoId: actualItem.videoId,
              videoUrl: actualItem.videoUrl,
              result: saveResult.result,
              attempts,
              durationMs: saveResult.durationMs,
              timestamp: new Date().toISOString()
            });

            ctx.logEvent(PHASE, "info", "chunked-move.copy-item", "Copied item", {
              chunkIndex,
              sourceIndex: item.sourceIndex,
              rowIndex,
              title: actualItem.title,
              result: saveResult.result,
              attempts,
              durationMs: saveResult.durationMs
            });

            if (saveResult.result === "saved") {
              savedCount += 1;
            } else {
              alreadySavedCount += 1;
              skippedCount += 1;
            }
            globalMutationCount += 1;

            // Throttle detection
            recentDurations.push(saveResult.durationMs);
            if (recentDurations.length > THROTTLE_WINDOW) {
              recentDurations.shift();
            }
            if (recentDurations.length >= THROTTLE_WINDOW) {
              const avgRecent = recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length;
              if (avgRecent > THROTTLE_THRESHOLD_MS) {
                ctx.logEvent(PHASE, "warn", "chunked-move.throttle-detected", "YouTube may be throttling — item durations increasing", {
                  avgRecentMs: Math.round(avgRecent),
                  thresholdMs: THROTTLE_THRESHOLD_MS,
                  chunkIndex,
                  globalMutationCount
                });
                if (emitJson) {
                  emitJsonLine(ctx.runId, {
                    type: "progress",
                    phase: "copy",
                    completed: savedCount + alreadySavedCount,
                    total: totalItems,
                    message: `Warning: YouTube may be throttling (avg ${Math.round(avgRecent / 1000)}s/item)`
                  });
                }
              }
            }
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
              rowIndex,
              title: item.title,
              videoId: item.videoId,
              result: "failed",
              attempts: retryPolicy.maxAttempts,
              error: message,
              ...(fs.existsSync(screenshotPath) ? { screenshotPath } : {}),
              timestamp: new Date().toISOString()
            });
            ctx.logEvent(PHASE, "error", "chunked-move.copy-failed", "Copy item failed", {
              chunkIndex, sourceIndex: item.sourceIndex, rowIndex,
              error: message, attempts: retryPolicy.maxAttempts
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
            if (emitJson && pacingDelay.cooldownMs > 0) {
              emitJsonLine(ctx.runId, {
                type: "progress",
                phase: "copy",
                completed: savedCount + alreadySavedCount,
                total: totalItems,
                message: `Pacing cooldown ${Math.round(pacingDelay.cooldownMs / 1000)}s to avoid rate limits…`
              });
            }
            await session.page.waitForTimeout(pacingDelay.totalDelayMs);
          }

          if (emitJson) {
            emitJsonLine(ctx.runId, {
              type: "item",
              phase: "copy",
              completed: savedCount + alreadySavedCount,
              total: totalItems,
              item: {
                sourceIndex: item.sourceIndex,
                title: item.title,
                channelName: item.channelName,
                videoId: item.videoId,
                videoUrl: item.videoUrl,
                thumbnailUrl: thumbnailUrlForVideoId(item.videoId),
                result: "saved"
              },
              occurredAt: new Date().toISOString()
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

          // (skip verify event — no need to transition phases in UI for clean chunks)

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

        // (verify progress is inline — no separate UI phase event needed)

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
              let removedItem: InventoryItem | undefined;
              const { attempts } = await runWithRetries({
                policy: retryPolicy,
                run: async () => {
                  removedItem = await removeTopWatchLaterItemUnvalidated(session.page);
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

              const deleted = removedItem ?? item;
              appendOperation(operationsPath, {
                phase: "delete",
                chunkIndex,
                sourceIndex: item.sourceIndex,
                title: deleted.title,
                videoId: deleted.videoId,
                result: "removed",
                attempts,
                timestamp: new Date().toISOString()
              });

              ctx.logEvent(PHASE, "info", "chunked-move.delete-item", "Deleted item", {
                chunkIndex,
                sourceIndex: item.sourceIndex,
                title: deleted.title,
                videoId: deleted.videoId,
                attempts
              });

              removedCount += 1;
              globalMutationCount += 1;

              if (emitJson) {
                emitJsonLine(ctx.runId, {
                  type: "item",
                  phase: "delete",
                  completed: removedCount,
                  total: totalItems,
                  item: {
                    sourceIndex: item.sourceIndex,
                    title: deleted.title ?? item.title,
                    channelName: deleted.channelName ?? item.channelName,
                    videoId: deleted.videoId ?? item.videoId,
                    videoUrl: deleted.videoUrl ?? item.videoUrl,
                    thumbnailUrl: thumbnailUrlForVideoId(deleted.videoId ?? item.videoId),
                    result: "removed"
                  },
                  occurredAt: new Date().toISOString()
                });
              }
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
        const rate = formatRate(savedCount + alreadySavedCount, startedAtMs);
        emitJsonLine(ctx.runId, {
          type: "progress",
          phase: "copy",
          completed: savedCount + alreadySavedCount,
          total: totalItems,
          message: `Chunk ${completedChunks}/${totalChunks} done — ${removedCount} moved, ${rate} items/sec`
        });
      }

      // Inter-chunk cooldown (skip after the last chunk)
      if (chunkIndex < totalChunks - 1 && interChunkCooldownMs > 0) {
        ctx.logEvent(PHASE, "info", "chunked-move.inter-chunk-cooldown", "Cooling down between chunks", {
          chunkIndex,
          cooldownMs: interChunkCooldownMs
        });
        if (emitJson) {
          emitJsonLine(ctx.runId, {
            type: "progress",
            phase: "copy",
            completed: savedCount + alreadySavedCount,
            total: totalItems,
            message: `Cooling down ${Math.round(interChunkCooldownMs / 1000)}s to avoid YouTube rate limits…`
          });
        }
        await session.page.waitForTimeout(interChunkCooldownMs);

        // Quick auth re-check before the next chunk (no networkidle)
        try {
          const accountBtn = session.page.locator("button#avatar-btn, button[aria-label*='Google Account'], button[aria-label*='Account menu']");
          const stillSignedIn = await accountBtn.count().catch(() => 0);
          if (!stillSignedIn) {
            throw new AuthenticationRequiredError({
              snapshot: { signedIn: false, accountLabel: null, currentUrl: session.page.url(), pageTitle: "" },
              reason: "not-signed-in-to-youtube",
              contextLabel: `chunk.${chunkIndex}.post-cooldown`
            });
          }
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
      emitJsonLine(ctx.runId, {
        type: "result",
        ok: true,
        runId: ctx.runId,
        targetPlaylist: resolvedTargetPlaylist,
        artifacts: { summaryPath: path.join(ctx.artifacts.runDir, "summary.json") }
      });
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
      emitJsonLine(ctx.runId, {
        type: "result",
        ok: false,
        runId: ctx.runId,
        targetPlaylist,
        error: message
      });
    }

    throw error;
  } finally {
    await session.close();
  }

}

function emitJsonLine(runId: string, payload: Record<string, unknown>): void {
  const envelope = buildMoveAppPayload(runId, payload);
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

function thumbnailUrlForVideoId(videoId: string | null | undefined): string | null {
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}
