import fs from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { launchBrowserSession } from "../browser/launch.js";
import { loadPlaylistInventory, loadWatchLaterInventory, type InventoryOptions } from "../browser/youtube/inventory.js";
import { resolvePlaylistPageUrlByName } from "../browser/youtube/playlistDiscovery.js";
import { assertUsableSourceSnapshot, readSourceSnapshot, resolveSourceSnapshotPath, computeInventoryFingerprint } from "../services/sourceSnapshot.js";
import { ambiguousSourceItemMismatches, partitionSourceItems } from "../services/sourceItemPolicy.js";
import { analyzeInventoryDiscrepancies, compareOrderedPrefix, discrepanciesAreClear, evaluateVerificationCounts, findMatchingWindowStart } from "../services/verification.js";
import { buildProductionDeleteAuthorization, evaluateDeletionEligibility } from "../services/verificationGate.js";

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

export async function runVerify(command: Command): Promise<void> {
  const ctx = createRunContext(command, "verify");
  const localOptions = command.opts<{
    maxItems?: string;
    maxNoGrowthPasses?: string;
    settleMs?: string;
    targetPlaylist?: string;
    sourceRunId?: string;
  }>();
  const targetPlaylist = getTargetPlaylist(command);
  const watchLaterUrl = `${ctx.config.youtubeBaseUrl}/playlist?list=WL`;
  const verificationPath = path.join(ctx.artifacts.runDir, "verification.json");
  const subsetLimit = localOptions.maxItems ? parsePositiveInt(localOptions.maxItems, 0) : undefined;
  const snapshotPath = resolveSourceSnapshotPath(ctx.rootDir, ctx.runId, localOptions.sourceRunId);
  const sourceSnapshot = readSourceSnapshot(snapshotPath);
  const sourceItems = subsetLimit ? sourceSnapshot.items.slice(0, subsetLimit) : sourceSnapshot.items;
  assertUsableSourceSnapshot(sourceSnapshot, sourceItems.length);
  const partitionedSource = partitionSourceItems(sourceItems);
  const targetSourceItems = partitionedSource.copyableItems;

  const session = await launchBrowserSession(ctx.config);

  try {
    const inventoryOptions = {
      maxNoGrowthPasses: parsePositiveInt(localOptions.maxNoGrowthPasses, 2),
      settleMs: parsePositiveInt(localOptions.settleMs, 1_200),
      onScrollPass: ({
        pass,
        rowCount,
        previousRowCount,
        noGrowthPasses
      }: Parameters<NonNullable<InventoryOptions["onScrollPass"]>>[0]) => {
        ctx.logEvent("verify", "info", "verify.inventory-pass", "Verification inventory pass", {
          pass,
          rowCount,
          previousRowCount,
          noGrowthPasses
        });
      }
    };

    ctx.logEvent("verify", "info", "verify.source-snapshot", "Loaded source snapshot", {
      sourceSnapshotRunId: sourceSnapshot.runId,
      sourceSnapshotPath: snapshotPath,
      sourceTotal: sourceSnapshot.total,
      selectedCount: sourceItems.length,
      sourceFingerprint: sourceSnapshot.fingerprint,
      copyableCount: targetSourceItems.length,
      expectedNonCopyableCount: partitionedSource.expectedNonCopyableItems.length,
      ambiguousCount: partitionedSource.ambiguousItems.length
    });

    const targetPlaylistUrl = await resolvePlaylistPageUrlByName(session.page, ctx.config.youtubeBaseUrl, targetPlaylist);
    if (!targetPlaylistUrl) {
      throw new Error(`Target playlist '${targetPlaylist}' was not found on the Playlists feed page`);
    }

    const targetInventory = await loadPlaylistInventory(session.page, targetPlaylistUrl, {
      ...inventoryOptions
    });

    const driftInventory = await loadWatchLaterInventory(session.page, watchLaterUrl, {
      ...inventoryOptions,
      ...(subsetLimit ? { maxItems: subsetLimit } : {})
    });

    const targetWindowStart = subsetLimit ? findMatchingWindowStart(targetSourceItems, targetInventory.items) : 0;
    const targetWindowItems =
      subsetLimit && targetWindowStart !== null
        ? targetInventory.items.slice(targetWindowStart, targetWindowStart + targetSourceItems.length)
        : subsetLimit
          ? []
          : targetInventory.items;
    const targetMismatches = [
      ...ambiguousSourceItemMismatches(partitionedSource.ambiguousItems),
      ...compareOrderedPrefix(targetSourceItems, targetWindowItems)
    ];
    const driftMismatches = compareOrderedPrefix(sourceItems, driftInventory.items);
    const targetDiscrepancySummary = analyzeInventoryDiscrepancies(targetSourceItems, targetWindowItems);
    const driftDiscrepancySummary = analyzeInventoryDiscrepancies(sourceItems, driftInventory.items);
    const { targetCountMatches, driftCountMatches } = evaluateVerificationCounts({
      subsetLimit,
      sourceCount: targetSourceItems.length,
      targetCount: targetInventory.items.length,
      driftCount: driftInventory.items.length
    });
    const targetDiscrepanciesClear = subsetLimit
      ? targetWindowStart !== null && discrepanciesAreClear(targetDiscrepancySummary)
      : discrepanciesAreClear(targetDiscrepancySummary);
    const driftDiscrepanciesClear = subsetLimit ? true : discrepanciesAreClear(driftDiscrepancySummary);
    const targetPassed =
      targetMismatches.length === 0 &&
      targetCountMatches &&
      targetDiscrepanciesClear &&
      partitionedSource.ambiguousItems.length === 0;
    const driftPassed = driftMismatches.length === 0 && driftCountMatches && driftDiscrepanciesClear;
    const passed = targetPassed && driftPassed;
    const driftFingerprint = computeInventoryFingerprint(driftInventory.items);
    const deletionEligibility = evaluateDeletionEligibility({
      passed,
      targetPassed,
      driftPassed,
      subsetLimit: subsetLimit ?? null,
      sourceSnapshotMetadataComplete: sourceSnapshot.metadataComplete,
      sourceSnapshotBounded: sourceSnapshot.bounded,
      expectedNonCopyableCount: partitionedSource.expectedNonCopyableItems.length,
      ambiguousSourceCount: partitionedSource.ambiguousItems.length,
      targetCountMatches,
      driftCountMatches,
      targetDiscrepanciesClear,
      driftDiscrepanciesClear,
      sourceSnapshotRunId: sourceSnapshot.runId
    });
    const productionDeleteAuthorization = buildProductionDeleteAuthorization({
      verificationRunId: ctx.runId,
      sourceSnapshotRunId: sourceSnapshot.runId,
      targetPlaylist,
      subsetLimit: subsetLimit ?? null,
      sourceSnapshotMetadataComplete: sourceSnapshot.metadataComplete,
      sourceSnapshotBounded: sourceSnapshot.bounded,
      eligibility: deletionEligibility
    });

    const report = {
      reportVersion: 1,
      reportComplete: true,
      capturedAt: new Date().toISOString(),
      sourcePlaylist: "Watch Later",
      targetPlaylist,
      targetPlaylistUrl,
      sourceSnapshotRunId: sourceSnapshot.runId,
      sourceSnapshotPath: snapshotPath,
      sourceCount: sourceItems.length,
      sourceSnapshotMetadataVersion: sourceSnapshot.metadataVersion,
      sourceSnapshotMetadataComplete: sourceSnapshot.metadataComplete,
      sourceSnapshotBounded: sourceSnapshot.bounded,
      sourceSnapshotRequestedMaxItems: sourceSnapshot.requestedMaxItems,
      copyableSourceCount: targetSourceItems.length,
      expectedNonCopyableCount: partitionedSource.expectedNonCopyableItems.length,
      ambiguousSourceCount: partitionedSource.ambiguousItems.length,
      targetCount: targetInventory.items.length,
      driftCount: driftInventory.items.length,
      sourceFingerprint: sourceSnapshot.fingerprint,
      driftFingerprint,
      subsetLimit: subsetLimit ?? null,
      passed,
      targetPassed,
      driftPassed,
      targetCountMatches,
      driftCountMatches,
      targetDiscrepanciesClear,
      driftDiscrepanciesClear,
      verificationMode: subsetLimit || sourceSnapshot.bounded || !sourceSnapshot.metadataComplete ? "subset" : "full",
      productionDeleteAuthorization,
      targetDiscrepancySummary,
      driftDiscrepancySummary,
      targetWindowStart,
      targetWindowMatched: targetWindowStart !== null,
      targetMismatches,
      driftMismatches,
      sourceItems,
      targetItems: targetInventory.items,
      driftItems: driftInventory.items
    };

    fs.writeFileSync(verificationPath, `${JSON.stringify(report, null, 2)}\n`);

    ctx.saveCheckpoint("verify", {
      verificationPath,
      passed,
      targetPassed,
      driftPassed,
      sourceSnapshotRunId: sourceSnapshot.runId,
      sourceSnapshotPath: snapshotPath,
      sourceCount: sourceItems.length,
      sourceSnapshotMetadataVersion: sourceSnapshot.metadataVersion,
      sourceSnapshotMetadataComplete: sourceSnapshot.metadataComplete,
      sourceSnapshotBounded: sourceSnapshot.bounded,
      sourceSnapshotRequestedMaxItems: sourceSnapshot.requestedMaxItems,
      copyableSourceCount: targetSourceItems.length,
      expectedNonCopyableCount: partitionedSource.expectedNonCopyableItems.length,
      ambiguousSourceCount: partitionedSource.ambiguousItems.length,
      targetCount: targetInventory.items.length,
      driftCount: driftInventory.items.length,
      targetMismatchCount: targetMismatches.length,
      driftMismatchCount: driftMismatches.length,
      targetOrderMismatchCount: targetDiscrepancySummary.orderMismatchCount,
      driftOrderMismatchCount: driftDiscrepancySummary.orderMismatchCount,
      targetWindowStart,
      targetWindowMatched: targetWindowStart !== null,
      targetCountMatches,
      driftCountMatches,
      targetDiscrepanciesClear,
      driftDiscrepanciesClear,
      verificationMode: subsetLimit || sourceSnapshot.bounded || !sourceSnapshot.metadataComplete ? "subset" : "full",
      deletionEligible: deletionEligibility.eligible,
      deletionBlockedBy: deletionEligibility.reasons,
      productionDeleteAuthorized: productionDeleteAuthorization.authorized,
      targetPlaylist,
      targetPlaylistUrl
    });

    ctx.logEvent("verify", passed ? "info" : "warn", "verify.complete", "Verification completed", {
      verificationPath,
      passed,
      targetPassed,
      driftPassed,
      sourceSnapshotRunId: sourceSnapshot.runId,
      sourceCount: sourceItems.length,
      sourceSnapshotMetadataVersion: sourceSnapshot.metadataVersion,
      sourceSnapshotMetadataComplete: sourceSnapshot.metadataComplete,
      sourceSnapshotBounded: sourceSnapshot.bounded,
      sourceSnapshotRequestedMaxItems: sourceSnapshot.requestedMaxItems,
      copyableSourceCount: targetSourceItems.length,
      expectedNonCopyableCount: partitionedSource.expectedNonCopyableItems.length,
      ambiguousSourceCount: partitionedSource.ambiguousItems.length,
      targetCount: targetInventory.items.length,
      driftCount: driftInventory.items.length,
      targetMismatchCount: targetMismatches.length,
      driftMismatchCount: driftMismatches.length,
      targetOrderMismatchCount: targetDiscrepancySummary.orderMismatchCount,
      driftOrderMismatchCount: driftDiscrepancySummary.orderMismatchCount,
      targetWindowStart,
      targetWindowMatched: targetWindowStart !== null,
      targetCountMatches,
      driftCountMatches,
      targetDiscrepanciesClear,
      driftDiscrepanciesClear,
      verificationMode: subsetLimit || sourceSnapshot.bounded || !sourceSnapshot.metadataComplete ? "subset" : "full",
      deletionEligible: deletionEligibility.eligible,
      deletionBlockedBy: deletionEligibility.reasons,
      productionDeleteAuthorized: productionDeleteAuthorization.authorized,
      targetPlaylist,
      targetPlaylistUrl
    });
    ctx.db.upsertRunState("verify", passed ? "complete" : "failed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.logEvent("verify", "error", "verify.failed", "Verification failed", { error: message, targetPlaylist });
    ctx.db.upsertRunState("verify", "failed");
    throw error;
  } finally {
    await session.close();
  }
}
