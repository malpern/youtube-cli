import type { Page } from "playwright";

import type { InventoryItem, RunConfig } from "../models/types.js";
import { loadPlaylistInventory } from "../browser/youtube/inventory.js";
import { assertAuthenticatedYouTubeSession } from "./authGuard.js";

export interface ChunkVerificationResult {
  passed: boolean;
  matchedCount: number;
  checkedCount: number;
  missingVideoIds: string[];
  targetItemsLoaded: number;
}

export async function verifyChunkInTargetPlaylist(args: {
  page: Page;
  targetPlaylistUrl: string;
  chunkCopyableItems: InventoryItem[];
  maxScrollItems: number;
  config: RunConfig;
  authLabel: string;
}): Promise<ChunkVerificationResult> {
  const { page, targetPlaylistUrl, chunkCopyableItems, maxScrollItems, config, authLabel } = args;

  if (chunkCopyableItems.length === 0) {
    return {
      passed: true,
      matchedCount: 0,
      checkedCount: 0,
      missingVideoIds: [],
      targetItemsLoaded: 0
    };
  }

  await assertAuthenticatedYouTubeSession(page, config, `${authLabel}.before`);

  const targetInventory = await loadPlaylistInventory(page, targetPlaylistUrl, {
    maxNoGrowthPasses: 3,
    settleMs: 1500,
    maxItems: maxScrollItems
  });

  await assertAuthenticatedYouTubeSession(page, config, `${authLabel}.after`);

  const targetVideoIds = new Set(
    targetInventory.items
      .map((item) => item.videoId)
      .filter((id): id is string => id !== null)
  );

  const missingVideoIds: string[] = [];

  for (const item of chunkCopyableItems) {
    if (item.videoId && !targetVideoIds.has(item.videoId)) {
      missingVideoIds.push(item.videoId);
    }
  }

  return {
    passed: missingVideoIds.length === 0,
    matchedCount: chunkCopyableItems.length - missingVideoIds.length,
    checkedCount: chunkCopyableItems.length,
    missingVideoIds,
    targetItemsLoaded: targetInventory.items.length
  };
}
