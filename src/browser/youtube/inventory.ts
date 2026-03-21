import type { Page } from "playwright";

import type { InventoryItem } from "../../models/types.js";

const ROW_SELECTOR = "ytd-playlist-video-renderer";

export interface InventoryOptions {
  maxNoGrowthPasses: number;
  settleMs: number;
  maxItems?: number;
  onScrollPass?: (details: {
    pass: number;
    rowCount: number;
    previousRowCount: number;
    noGrowthPasses: number;
  }) => void;
}

export interface InventoryResult {
  items: InventoryItem[];
  finalRowCount: number;
  scrollPasses: number;
}

export async function loadPlaylistInventory(
  page: Page,
  playlistUrl: string,
  options: InventoryOptions
): Promise<InventoryResult> {
  await page.goto(playlistUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  let pass = 0;
  let previousRowCount = 0;
  let noGrowthPasses = 0;

  while (noGrowthPasses < options.maxNoGrowthPasses) {
    const rowCount = await page.locator(ROW_SELECTOR).count();
    pass += 1;

    options.onScrollPass?.({
      pass,
      rowCount,
      previousRowCount,
      noGrowthPasses
    });

    if (rowCount <= previousRowCount) {
      noGrowthPasses += 1;
    } else {
      noGrowthPasses = 0;
      previousRowCount = rowCount;
    }

    if (options.maxItems && rowCount >= options.maxItems) {
      break;
    }

    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await page.waitForTimeout(options.settleMs);
  }

  const items = await extractInventoryItems(page, options.maxItems);

  return {
    items,
    finalRowCount: items.length,
    scrollPasses: pass
  };
}

export async function loadWatchLaterInventory(
  page: Page,
  watchLaterUrl: string,
  options: InventoryOptions
): Promise<InventoryResult> {
  return loadPlaylistInventory(page, watchLaterUrl, options);
}

async function extractInventoryItems(page: Page, maxItems?: number): Promise<InventoryItem[]> {
  const items = await page.locator(ROW_SELECTOR).evaluateAll((rows, max) => {
    const normalizedRows = rows.slice(0, typeof max === "number" ? max : rows.length);

    return normalizedRows.map((row, index) => {
      const titleAnchor = row.querySelector<HTMLAnchorElement>("a#video-title");
      const channelAnchor = row.querySelector<HTMLAnchorElement>("ytd-channel-name a, a.yt-simple-endpoint.style-scope.yt-formatted-string");
      const metadata = Array.from(row.querySelectorAll("#metadata-line span"))
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" | ");
      const title = titleAnchor?.textContent?.trim() ?? null;
      const videoUrl = titleAnchor?.href ?? null;
      const lowerText = row.textContent?.toLowerCase() ?? "";

      let unavailableKind: InventoryItem["unavailableKind"] = "none";
      if (lowerText.includes("private video")) {
        unavailableKind = "private";
      } else if (lowerText.includes("deleted video")) {
        unavailableKind = "deleted";
      } else if (lowerText.includes("unavailable")) {
        unavailableKind = "unavailable";
      } else if (!videoUrl) {
        unavailableKind = "unknown";
      }

      const videoId = videoUrl
        ? new URL(videoUrl).searchParams.get("v")
        : null;

      return {
        sourceIndex: index + 1,
        title,
        videoUrl,
        videoId,
        channelName: channelAnchor?.textContent?.trim() ?? null,
        metadataText: metadata || null,
        unavailableKind
      };
    });
  }, maxItems);

  return items;
}
