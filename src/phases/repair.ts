import fs from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { launchBrowserSession } from "../browser/launch.js";
import { ensureVideoSavedToPlaylist } from "../browser/youtube/saveToPlaylist.js";
import type { InventoryItem } from "../models/types.js";
import { readCheckpointFile } from "../services/checkpointFile.js";
import { readSourceSnapshot, resolveSourceSnapshotPath } from "../services/sourceSnapshot.js";
import { assessSourceItemPolicy } from "../services/sourceItemPolicy.js";
import { planRepair } from "../services/repairPlanner.js";
import { planRepairResume } from "../services/resumePlanner.js";
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

function getTargetPlaylist(command: Command): string {
  const opts = command.opts<{ targetPlaylist?: string }>();
  return opts.targetPlaylist?.trim() || "Old Watch";
}

function appendRepairOperation(
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

export async function runRepair(command: Command): Promise<void> {
  const ctx = createRunContext(command, "repair");
  const localOptions = command.opts<{
    targetPlaylist?: string;
    verificationRunId?: string;
    milestoneEvery?: string;
    maxItems?: string;
    resume?: boolean;
  }>();
  const targetPlaylist = getTargetPlaylist(command);
  const milestoneEvery = parsePositiveInt(localOptions.milestoneEvery, 5);
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

  if (verificationReport.targetPlaylist !== targetPlaylist) {
    throw new Error(
      `Verification report target playlist '${verificationReport.targetPlaylist}' does not match requested target playlist '${targetPlaylist}'`
    );
  }

  if (repairPlan.blockedReasons.length > 0) {
    ctx.logEvent("repair", "error", "repair.blocked", "Repair is blocked by verification state", {
      verificationPath,
      blockedReasons: repairPlan.blockedReasons,
      targetPlaylist
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
        skippedCount: 0,
        failedCount: 0
      };

  if (resumePlan.remainingItems.length === 0) {
    ctx.logEvent("repair", "info", "repair.noop", "Repair plan has no retry candidates", {
      verificationPath,
      sourceSnapshotRunId: sourceSnapshot.runId,
      targetPlaylist,
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
      resumeProcessedCount: resumePlan.processedCount
    });

    let repairedCount = resumePlan.repairedCount;
    let skippedCount = resumePlan.skippedCount;
    let failedCount = resumePlan.failedCount;

    for (const [index, item] of resumePlan.remainingItems.entries()) {
      const policy = assessSourceItemPolicy(item);
      if (policy.policy !== "copyable") {
        appendRepairOperation(operationsPath, {
          sourceIndex: item.sourceIndex,
          title: item.title,
          videoId: item.videoId,
          videoUrl: item.videoUrl,
          result: `skipped-${policy.policy}`,
          error: policy.reason,
          timestamp: new Date().toISOString()
        });
        skippedCount += 1;
      } else {
        try {
          const videoUrl = item.videoUrl;
          if (!videoUrl) {
            throw new Error(`Repair candidate '${item.sourceIndex}' is missing a videoUrl`);
          }

          const result = await ensureVideoSavedToPlaylist(session.page, videoUrl, targetPlaylist);
          appendRepairOperation(operationsPath, {
            sourceIndex: item.sourceIndex,
            title: item.title,
            videoId: item.videoId,
            videoUrl,
            result,
            timestamp: new Date().toISOString()
          });
          if (result === "saved" || result === "already-saved") {
            repairedCount += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const screenshotPath = path.join(ctx.artifacts.screenshotsDir, `repair-failure-${item.sourceIndex}.png`);
          await session.page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
          appendRepairOperation(operationsPath, {
            sourceIndex: item.sourceIndex,
            title: item.title,
            videoId: item.videoId,
            videoUrl: item.videoUrl,
            result: "failed",
            error: message,
            timestamp: new Date().toISOString()
          });
          failedCount += 1;
        }
      }

      const processedCount = resumePlan.processedCount + index + 1;
      if (processedCount % milestoneEvery === 0 || processedCount === repairItems.length) {
        ctx.logEvent("repair", "info", "repair.progress", "Repair progress milestone", {
          processed: processedCount,
          total: repairItems.length,
          repairedCount,
          skippedCount,
          failedCount,
          targetPlaylist
        });
      }

      ctx.saveCheckpoint("repair", {
        verificationPath,
        sourceSnapshotRunId: sourceSnapshot.runId,
        targetPlaylist,
        processed: processedCount,
        total: repairItems.length,
        repairedCount,
        skippedCount,
        failedCount
      });
    }

    ctx.logEvent("repair", "info", "repair.complete", "Repair pass completed", {
      verificationPath,
      sourceSnapshotRunId: sourceSnapshot.runId,
      targetPlaylist,
      total: repairItems.length,
      repairedCount,
      skippedCount,
      failedCount,
      operationsPath
    });
    ctx.db.upsertRunState("repair", "complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.logEvent("repair", "error", "repair.failed", "Repair pass failed", {
      error: message,
      verificationPath,
      targetPlaylist
    });
    ctx.db.upsertRunState("repair", "failed");
    throw error;
  } finally {
    await session.close();
  }
}
