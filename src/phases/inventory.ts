import fs from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { launchBrowserSession } from "../browser/launch.js";
import { loadWatchLaterInventory } from "../browser/youtube/inventory.js";
import type { InventoryOptions } from "../browser/youtube/inventory.js";
import { computeInventoryFingerprint } from "../services/sourceSnapshot.js";

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

export async function runInventory(command: Command): Promise<void> {
  const ctx = createRunContext(command, "inventory");
  const localOptions = command.opts<{ maxItems?: string; maxNoGrowthPasses?: string; settleMs?: string }>();
  const watchLaterUrl = `${ctx.config.youtubeBaseUrl}/playlist?list=WL`;
  const inventoryPath = path.join(ctx.artifacts.runDir, "inventory.json");
  const screenshotPath = path.join(ctx.artifacts.screenshotsDir, "inventory-watch-later.png");
  const requestedMaxItems = localOptions.maxItems ? parsePositiveInt(localOptions.maxItems, 0) : null;

  const session = await launchBrowserSession(ctx.config);

  try {
    const inventoryOptions = {
      maxNoGrowthPasses: parsePositiveInt(localOptions.maxNoGrowthPasses, 3),
      settleMs: parsePositiveInt(localOptions.settleMs, 1_500),
      onScrollPass: ({
        pass,
        rowCount,
        previousRowCount,
        noGrowthPasses
      }: Parameters<NonNullable<InventoryOptions["onScrollPass"]>>[0]) => {
        ctx.logEvent("inventory", "info", "inventory.scroll-pass", "Inventory scroll pass", {
          pass,
          rowCount,
          previousRowCount,
          noGrowthPasses
        });
      }
    };

    const result = await loadWatchLaterInventory(session.page, watchLaterUrl, {
      ...inventoryOptions,
      ...(requestedMaxItems ? { maxItems: requestedMaxItems } : {})
    });
    const fingerprint = computeInventoryFingerprint(result.items);

    fs.writeFileSync(
      inventoryPath,
      `${JSON.stringify(
        {
          currentUrl: session.page.url(),
          capturedAt: new Date().toISOString(),
          metadataVersion: 1,
          total: result.items.length,
          scrollPasses: result.scrollPasses,
          requestedMaxItems,
          bounded: requestedMaxItems !== null,
          fingerprint,
          items: result.items
        },
        null,
        2
      )}\n`
    );

    let screenshotCaptured = false;
    let screenshotError: string | null = null;
    try {
      await session.page.screenshot({ path: screenshotPath, fullPage: true });
      screenshotCaptured = true;
    } catch (error) {
      screenshotError = error instanceof Error ? error.message : String(error);
      ctx.logEvent("inventory", "warn", "inventory.screenshot-failed", "Inventory screenshot failed after snapshot write", {
        screenshotPath,
        error: screenshotError
      });
    }

    ctx.saveCheckpoint("inventory", {
      inventoryPath,
      screenshotPath: screenshotCaptured ? screenshotPath : null,
      screenshotCaptured,
      screenshotError,
      metadataVersion: 1,
      total: result.items.length,
      scrollPasses: result.scrollPasses,
      requestedMaxItems,
      bounded: requestedMaxItems !== null,
      fingerprint
    });

    ctx.logEvent("inventory", "info", "inventory.complete", "Inventory completed", {
      inventoryPath,
      screenshotPath: screenshotCaptured ? screenshotPath : null,
      screenshotCaptured,
      screenshotError,
      metadataVersion: 1,
      total: result.items.length,
      scrollPasses: result.scrollPasses,
      requestedMaxItems,
      bounded: requestedMaxItems !== null,
      fingerprint
    });
    ctx.db.upsertRunState("inventory", "complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.logEvent("inventory", "error", "inventory.failed", "Inventory failed", { error: message });
    ctx.db.upsertRunState("inventory", "failed");
    throw error;
  } finally {
    await session.close();
  }
}
