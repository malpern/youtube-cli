import fs from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { launchBrowserSession } from "../browser/launch.js";
import { ensureVideoSavedToPlaylist } from "../browser/youtube/saveToPlaylist.js";
import type { InventoryItem } from "../models/types.js";
import { readCheckpointFile } from "../services/checkpointFile.js";
import { planCopyResume } from "../services/resumePlanner.js";
import { assertUsableSourceSnapshot, readSourceSnapshot, resolveSourceSnapshotPath } from "../services/sourceSnapshot.js";
import { assessSourceItemPolicy, partitionSourceItems } from "../services/sourceItemPolicy.js";

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

function getTargetPlaylist(command: Command): string {
  const opts = command.opts<{ targetPlaylist?: string }>();
  return opts.targetPlaylist?.trim() || "Old Watch";
}

function formatRate(processedCount: number, startedAtMs: number): number {
  const elapsedSeconds = Math.max((Date.now() - startedAtMs) / 1000, 1);
  return Number((processedCount / elapsedSeconds).toFixed(2));
}

function appendCopyOperation(
  operationsPath: string,
  entry: {
    sourceIndex: number;
    title: string | null;
    videoId: string | null;
    videoUrl: string | null;
    result: string;
    error?: string;
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
    milestoneEvery?: string;
    sourceRunId?: string;
    resume?: boolean;
  }>();
  const targetPlaylist = getTargetPlaylist(command);
  const milestoneEvery = parsePositiveInt(localOptions.milestoneEvery, 5);
  const operationsPath = path.join(ctx.artifacts.runDir, "copy-operations.jsonl");
  const startedAtMs = Date.now();
  const snapshotPath = resolveSourceSnapshotPath(ctx.rootDir, ctx.runId, localOptions.sourceRunId);
  const sourceSnapshot = readSourceSnapshot(snapshotPath);
  const sourceItems = localOptions.maxItems
    ? sourceSnapshot.items.slice(0, parsePositiveInt(localOptions.maxItems, 0))
    : sourceSnapshot.items;
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
        remainingItems: sourceItems,
        savedCount: 0,
        skippedCount: 0,
        failedCount: 0
      };

  const session = await launchBrowserSession(ctx.config);

  try {
    ctx.logEvent("copy", "info", "copy.source-snapshot", "Loaded source snapshot", {
      sourceSnapshotRunId: sourceSnapshot.runId,
      sourceSnapshotPath: snapshotPath,
      sourceTotal: sourceSnapshot.total,
      selectedCount: sourceItems.length,
      sourceFingerprint: sourceSnapshot.fingerprint,
      resumed: resumePlan.resumed,
      resumeProcessedCount: resumePlan.processedCount
    });
    const partitionedSource = partitionSourceItems(sourceItems);
    ctx.logEvent("copy", "info", "copy.source-policy", "Assessed source item copy policy", {
      copyableCount: partitionedSource.copyableItems.length,
      expectedNonCopyableCount: partitionedSource.expectedNonCopyableItems.length,
      ambiguousCount: partitionedSource.ambiguousItems.length,
      sourceSnapshotRunId: sourceSnapshot.runId
    });
    let savedCount = resumePlan.savedCount;
    let skippedCount = resumePlan.skippedCount;
    let failedCount = resumePlan.failedCount;

    for (const [index, item] of resumePlan.remainingItems.entries()) {
      await processCopyItem({
        ctx,
        item,
        page: session.page,
        targetPlaylist,
        operationsPath,
        onSaved: () => {
          savedCount += 1;
        },
        onSkipped: () => {
          skippedCount += 1;
        },
        onFailed: () => {
          failedCount += 1;
        }
      });

      const processedCount = resumePlan.processedCount + index + 1;
      if (processedCount % milestoneEvery === 0 || processedCount === sourceItems.length) {
        ctx.logEvent("copy", "info", "copy.progress", "Copy progress milestone", {
          processed: processedCount,
          total: sourceItems.length,
          savedCount,
          skippedCount,
          failedCount,
          rateItemsPerSecond: formatRate(processedCount, startedAtMs),
          targetPlaylist,
          sourceSnapshotRunId: sourceSnapshot.runId
        });
      }

      ctx.saveCheckpoint("copy", {
        targetPlaylist,
        sourceSnapshotRunId: sourceSnapshot.runId,
        sourceSnapshotPath: snapshotPath,
        processed: item.sourceIndex,
        total: sourceItems.length,
        savedCount,
        skippedCount,
        failedCount
      });
    }

    ctx.logEvent("copy", "info", "copy.complete", "Copy pass completed", {
      targetPlaylist,
      total: sourceItems.length,
      savedCount,
      skippedCount,
      failedCount,
      operationsPath,
      sourceSnapshotRunId: sourceSnapshot.runId,
      sourceSnapshotPath: snapshotPath
    });
    ctx.db.upsertRunState("copy", "complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.logEvent("copy", "error", "copy.failed", "Copy pass failed", { error: message, targetPlaylist });
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
  targetPlaylist: string;
  operationsPath: string;
  onSaved: () => void;
  onSkipped: () => void;
  onFailed: () => void;
}): Promise<void> {
  const { ctx, item, page, targetPlaylist, operationsPath, onSaved, onSkipped, onFailed } = args;

  const policy = assessSourceItemPolicy(item);
  if (policy.policy === "expected-non-copyable") {
    appendCopyOperation(operationsPath, {
      sourceIndex: item.sourceIndex,
      title: item.title,
      videoId: item.videoId,
      videoUrl: item.videoUrl,
      result: "expected-non-copyable",
      error: policy.reason,
      timestamp: new Date().toISOString()
    });
    ctx.logEvent("copy", "warn", "copy.item-expected-non-copyable", "Skipped expected non-copyable item", {
      sourceIndex: item.sourceIndex,
      title: item.title,
      reason: policy.reason,
      targetPlaylist
    });
    onSkipped();
    return;
  }

  if (policy.policy === "ambiguous-unavailable") {
    appendCopyOperation(operationsPath, {
      sourceIndex: item.sourceIndex,
      title: item.title,
      videoId: item.videoId,
      videoUrl: item.videoUrl,
      result: "ambiguous-source-item",
      error: policy.reason,
      timestamp: new Date().toISOString()
    });
    ctx.logEvent("copy", "error", "copy.item-ambiguous-source", "Source item is ambiguous and was not copied", {
      sourceIndex: item.sourceIndex,
      title: item.title,
      reason: policy.reason,
      targetPlaylist
    });
    onFailed();
    return;
  }

  try {
    const videoUrl = item.videoUrl;
    if (!videoUrl) {
      throw new Error(`Copyable source item '${item.sourceIndex}' is missing a videoUrl`);
    }

    const result = await ensureVideoSavedToPlaylist(page, videoUrl, targetPlaylist);
    appendCopyOperation(operationsPath, {
      sourceIndex: item.sourceIndex,
      title: item.title,
      videoId: item.videoId,
      videoUrl,
      result,
      timestamp: new Date().toISOString()
    });

    ctx.logEvent("copy", "info", "copy.item", "Processed copy item", {
      sourceIndex: item.sourceIndex,
      title: item.title,
      result,
      targetPlaylist
    });

    if (result === "saved") {
      onSaved();
    } else {
      onSkipped();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const screenshotPath = path.join(ctx.artifacts.screenshotsDir, `copy-failure-${item.sourceIndex}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
    appendCopyOperation(operationsPath, {
      sourceIndex: item.sourceIndex,
      title: item.title,
      videoId: item.videoId,
      videoUrl: item.videoUrl,
      result: "failed",
      error: message,
      ...(fs.existsSync(screenshotPath) ? { screenshotPath } : {}),
      timestamp: new Date().toISOString()
    });
    ctx.logEvent("copy", "error", "copy.item-failed", "Copy item failed", {
      sourceIndex: item.sourceIndex,
      title: item.title,
      error: message,
      ...(fs.existsSync(screenshotPath) ? { screenshotPath } : {}),
      targetPlaylist
    });
    onFailed();
  }
}
