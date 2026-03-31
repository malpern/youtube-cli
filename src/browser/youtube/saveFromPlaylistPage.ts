import type { Locator, Page } from "playwright";

import type { InventoryItem } from "../../models/types.js";
import type { PlaylistTarget, SaveToPlaylistResult } from "./saveToPlaylist.js";
import { listVisiblePlaylistOptions } from "./saveToPlaylist.js";

const ROW_SELECTOR = "ytd-playlist-video-renderer";
const ROW_MENU_BUTTON_SELECTOR = [
  "ytd-menu-renderer button[aria-label*='Action menu']",
  "yt-icon-button.dropdown-trigger button",
  "ytd-menu-renderer yt-icon-button button",
  "button[aria-label*='More actions']"
].join(", ");
const PLAYLIST_BUTTON_SELECTOR = "button.ytButtonOrAnchorHost, button.ytButtonOrAnchorButton";
const NEW_PLAYLIST_BUTTON_SELECTOR = "button[aria-label='Create new playlist']";

export interface PlaylistPageSaveResult {
  result: SaveToPlaylistResult;
  durationMs: number;
  actualItem: InventoryItem;
}

export async function openWatchLaterForSaving(page: Page, watchLaterUrl: string): Promise<void> {
  // Skip navigation if we're already on the Watch Later page
  const currentUrl = page.url();
  if (currentUrl.includes("playlist") && currentUrl.includes("list=WL")) {
    const rowCount = await page.locator(ROW_SELECTOR).count().catch(() => 0);
    if (rowCount > 0) {
      return;
    }
  }

  await page.goto(watchLaterUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.locator(ROW_SELECTOR).first().waitFor({ state: "visible", timeout: 15_000 });
}

/**
 * Save a Watch Later playlist row to the target playlist using the row's
 * three-dot menu. Operates by row index (0-based) to walk through the
 * visible playlist in order.
 *
 * The row is scrolled into view before interaction. If the row is not yet
 * loaded (lazy-loaded playlist), this function scrolls the page to trigger
 * loading.
 */
export async function saveWatchLaterItemByIndex(
  page: Page,
  rowIndex: number,
  target: PlaylistTarget
): Promise<PlaylistPageSaveResult> {
  const startedAt = Date.now();
  const row = page.locator(ROW_SELECTOR).nth(rowIndex);

  // Scroll the row into view (handles lazy-loaded playlists)
  await row.scrollIntoViewIfNeeded({ timeout: 15_000 });
  await row.waitFor({ state: "visible", timeout: 15_000 });

  // Extract item info for logging (not for validation — WL order may have drifted)
  const actualItem = await extractRowItem(row);

  // Click the three-dot menu on the row
  const menuButton = row.locator(ROW_MENU_BUTTON_SELECTOR).filter({ visible: true }).first();
  await menuButton.click({ timeout: 10_000 });

  // Find and click "Save to playlist" in the menu
  const saveMenuItem = await findVisibleSaveToPlaylistMenuItem(page);
  await saveMenuItem.click({ timeout: 10_000 });

  // Wait for the playlist picker panel to appear
  await page.locator(NEW_PLAYLIST_BUTTON_SELECTOR).first().waitFor({ state: "visible", timeout: 10_000 });

  // Check if already saved to this playlist
  const playlistButton = await getPlaylistButtonForTarget(page, target);
  const alreadySaved = await playlistButton.getAttribute("aria-pressed").catch(() => null);
  if (alreadySaved === "true") {
    await page.keyboard.press("Escape").catch(() => undefined);
    return {
      result: "already-saved",
      durationMs: Date.now() - startedAt,
      actualItem
    };
  }

  // Click the target playlist button
  await playlistButton.click({ force: true, timeout: 10_000 });

  // Brief wait for YouTube to register the selection
  await page.waitForTimeout(500);

  // Close the panel
  await page.keyboard.press("Escape").catch(() => undefined);

  // Small delay for the panel to dismiss before the next row interaction
  await page.waitForTimeout(200);

  return {
    result: "saved",
    durationMs: Date.now() - startedAt,
    actualItem
  };
}

async function findVisibleSaveToPlaylistMenuItem(page: Page): Promise<Locator> {
  const candidates = [
    page.getByRole("menuitem", { name: /save to playlist/i }).filter({ visible: true }).first(),
    page.getByRole("option", { name: /save to playlist/i }).filter({ visible: true }).first(),
    page.locator("ytd-menu-service-item-renderer, tp-yt-paper-item").filter({ hasText: /Save to playlist/i }).filter({ visible: true }).first()
  ];

  for (const candidate of candidates) {
    if (await candidate.count()) {
      await candidate.waitFor({ state: "visible", timeout: 10_000 });
      return candidate;
    }
  }

  throw new Error("Save to playlist action was not visible in the row menu");
}

async function getPlaylistButtonForTarget(page: Page, target: PlaylistTarget): Promise<Locator> {
  const options = await listVisiblePlaylistOptions(page);
  const match = options.find((option) => {
    if (option.title !== target.title) return false;
    if (target.visibility !== undefined && target.visibility !== null && option.visibility !== target.visibility) return false;
    return true;
  });

  if (!match) {
    const available = options.map((o) => `${o.title} (${o.visibility ?? "?"})`).join(", ");
    throw new Error(`Playlist '${target.title}' not found in save panel. Available: ${available}`);
  }

  return page.locator(PLAYLIST_BUTTON_SELECTOR).nth(match.domIndex);
}

async function extractRowItem(row: Locator): Promise<InventoryItem> {
  return row.evaluate((node) => {
    const titleAnchor = node.querySelector<HTMLAnchorElement>("a#video-title");
    const channelAnchor = node.querySelector<HTMLAnchorElement>(
      "ytd-channel-name a, a.yt-simple-endpoint.style-scope.yt-formatted-string"
    );
    const metadata = Array.from(node.querySelectorAll("#metadata-line span"))
      .map((element) => element.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" | ");
    const title = titleAnchor?.textContent?.trim() ?? null;
    const videoUrl = titleAnchor?.href ?? null;
    const lowerText = node.textContent?.toLowerCase() ?? "";

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

    return {
      sourceIndex: 1,
      title,
      videoUrl,
      videoId: videoUrl ? new URL(videoUrl).searchParams.get("v") : null,
      channelName: channelAnchor?.textContent?.trim() ?? null,
      metadataText: metadata || null,
      unavailableKind
    };
  });
}

function matchesExpectedRow(expected: InventoryItem, actual: InventoryItem): boolean {
  if (expected.videoId && actual.videoId) {
    return expected.videoId === actual.videoId;
  }

  const expectedTitle = expected.title?.replace(/\s+/g, " ").trim().toLowerCase() ?? null;
  const actualTitle = actual.title?.replace(/\s+/g, " ").trim().toLowerCase() ?? null;

  if (expectedTitle && actualTitle) {
    return expectedTitle === actualTitle;
  }

  return expected.unavailableKind === actual.unavailableKind;
}

function describeItem(item: InventoryItem): string {
  return item.videoId ?? item.title ?? `${item.unavailableKind} item`;
}
