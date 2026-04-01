import type { Page } from "playwright";

const ROW_SELECTOR = "ytd-playlist-video-renderer";
const ROW_MENU_BUTTON_SELECTOR = [
  "ytd-menu-renderer button[aria-label*='Action menu']",
  "yt-icon-button.dropdown-trigger button",
  "ytd-menu-renderer yt-icon-button button",
  "button[aria-label*='More actions']"
].join(", ");
const REMOVE_MENU_ITEM_SELECTOR = "ytd-menu-service-item-renderer, tp-yt-paper-item";

// The playlist-level three-dot menu (not the per-video one)
const PLAYLIST_MENU_BUTTON_SELECTOR = [
  "ytd-playlist-header-renderer yt-icon-button#button",
  "ytd-playlist-header-renderer button[aria-label*='menu']",
  "ytd-playlist-header-renderer button[aria-label*='More actions']"
].join(", ");

export interface CleanupResult {
  unavailableFound: boolean;
  removedCount: number;
}

/**
 * Check if the Watch Later playlist has hidden unavailable videos.
 */
export async function hasUnavailableVideos(page: Page, watchLaterUrl: string): Promise<boolean> {
  await page.goto(watchLaterUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  // Look for the "unavailable videos are hidden" alert/banner
  const hiddenAlert = page.locator("ytd-alert-with-button-renderer").filter({
    hasText: /unavailable videos/i
  });

  return await hiddenAlert.count() > 0;
}

/**
 * Show unavailable videos by clicking the playlist menu → "Show unavailable videos".
 */
export async function showUnavailableVideos(page: Page): Promise<void> {
  // Scroll to top to ensure header is visible
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // Click the playlist-level three-dot menu button
  const menuButton = page.locator('ytd-playlist-header-renderer button[aria-label="Action menu"]')
    .filter({ visible: true }).first();
  await menuButton.waitFor({ state: "visible", timeout: 10_000 });
  await menuButton.click({ timeout: 10_000 });
  await page.waitForTimeout(500);

  // Find and click "Show unavailable videos"
  const showItem = await findMenuItemByText(page, /show unavailable videos/i);
  await showItem.click({ timeout: 10_000 });

  // Wait for the page to reload/update with unavailable videos visible
  await page.waitForTimeout(2_000);
  // Scroll to load all rows
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(1_500);
}

/**
 * Remove all currently visible unavailable/placeholder videos from the top of the list.
 * Returns the number removed.
 */
export async function removeUnavailableVideos(
  page: Page,
  onRemoved?: (count: number, title: string | null) => void
): Promise<number> {
  let removedCount = 0;

  // Scroll to load all rows first
  for (let scroll = 0; scroll < 10; scroll++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(800);
  }
  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  const totalRows = await page.locator(ROW_SELECTOR).count();

  // Scan all rows in reverse order (bottom-up avoids index shifting)
  for (let i = totalRows - 1; i >= 0; i--) {
    const row = page.locator(ROW_SELECTOR).nth(i);
    const visible = await row.isVisible().catch(() => false);
    if (!visible) continue;

    const rowText = await row.textContent().catch(() => "") ?? "";
    const lowerText = rowText.toLowerCase();
    const isUnavailable =
      lowerText.includes("private video") ||
      lowerText.includes("deleted video") ||
      lowerText.includes("[unavailable]");

    if (!isUnavailable) continue;

    // Scroll row into view
    await row.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);

    const title = await row.locator("a#video-title, span#video-title, #video-title").textContent()
      .catch(() => "unavailable video");

    // Click the row's three-dot menu
    const menuButton = row.locator(ROW_MENU_BUTTON_SELECTOR).filter({ visible: true }).first();
    const hasMenu = await menuButton.count().catch(() => 0);
    if (!hasMenu) continue;

    await menuButton.click({ timeout: 10_000 });

    const removeItem = await findRemoveMenuItem(page);
    if (!removeItem) {
      await page.keyboard.press("Escape").catch(() => undefined);
      continue;
    }

    await removeItem.click({ timeout: 10_000 });
    await page.waitForTimeout(500);

    removedCount += 1;
    onRemoved?.(removedCount, title?.trim() ?? null);
  }

  return removedCount;
}

/**
 * Full cleanup pipeline: check → show → remove all unavailable videos.
 */
export async function cleanupUnavailableVideos(
  page: Page,
  watchLaterUrl: string,
  onProgress?: (message: string) => void
): Promise<CleanupResult> {
  onProgress?.("Checking for unavailable videos...");

  await page.goto(watchLaterUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  // Check for the hidden alert
  const hiddenAlert = page.locator("ytd-alert-with-button-renderer").filter({
    hasText: /unavailable videos/i
  });

  const hasHidden = await hiddenAlert.count() > 0;
  if (!hasHidden) {
    onProgress?.("No unavailable videos found.");
    return { unavailableFound: false, removedCount: 0 };
  }

  onProgress?.("Found unavailable videos. Showing them...");
  await showUnavailableVideos(page);

  onProgress?.("Removing unavailable videos...");
  const removedCount = await removeUnavailableVideos(page, (count, title) => {
    onProgress?.(`Removed ${count}: ${title ?? "unavailable video"}`);
  });

  onProgress?.(`Cleanup complete. Removed ${removedCount} unavailable videos.`);
  return { unavailableFound: true, removedCount };
}

async function findMenuItemByText(page: Page, pattern: RegExp) {
  const candidates = [
    page.getByRole("menuitem", { name: pattern }).filter({ visible: true }).first(),
    page.getByRole("option", { name: pattern }).filter({ visible: true }).first(),
    page.locator("ytd-menu-service-item-renderer, tp-yt-paper-item")
      .filter({ hasText: pattern }).filter({ visible: true }).first()
  ];

  for (const candidate of candidates) {
    if (await candidate.count()) {
      await candidate.waitFor({ state: "visible", timeout: 10_000 });
      return candidate;
    }
  }

  throw new Error(`Menu item matching ${pattern} was not visible`);
}

async function findRemoveMenuItem(page: Page) {
  const patterns = [
    /remove from watch later/i,
    /remove from/i,
    /delete/i,
    /remove/i
  ];

  for (const pattern of patterns) {
    const candidates = [
      page.getByRole("menuitem", { name: pattern }).filter({ visible: true }).first(),
      page.getByRole("option", { name: pattern }).filter({ visible: true }).first(),
      page.locator(REMOVE_MENU_ITEM_SELECTOR).filter({ hasText: pattern }).filter({ visible: true }).first()
    ];

    for (const candidate of candidates) {
      if (await candidate.count()) {
        await candidate.waitFor({ state: "visible", timeout: 5_000 });
        return candidate;
      }
    }
  }

  return null;
}

async function waitForRowRemoval(page: Page, previousCount: number): Promise<void> {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const currentCount = await page.locator(ROW_SELECTOR).count();
    if (currentCount < previousCount) {
      return;
    }
    await page.waitForTimeout(300);
  }
}
