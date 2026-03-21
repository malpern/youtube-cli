import type { Locator, Page } from "playwright";

import type { InventoryItem } from "../../models/types.js";

const ROW_SELECTOR = "ytd-playlist-video-renderer";
const ROW_MENU_BUTTON_SELECTOR = [
  "ytd-menu-renderer button[aria-label*='Action menu']",
  "yt-icon-button.dropdown-trigger button",
  "ytd-menu-renderer yt-icon-button button",
  "button[aria-label*='More actions']"
].join(", ");
const REMOVE_MENU_ITEM_SELECTOR = "ytd-menu-service-item-renderer, tp-yt-paper-item";

export async function openWatchLaterForDeletion(page: Page, watchLaterUrl: string): Promise<void> {
  await page.goto(watchLaterUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.locator(ROW_SELECTOR).first().waitFor({ state: "visible", timeout: 15_000 });
}

export async function removeTopWatchLaterItem(page: Page, expectedItem: InventoryItem): Promise<void> {
  const firstRow = page.locator(ROW_SELECTOR).first();
  await firstRow.waitFor({ state: "visible", timeout: 15_000 });

  const actualItem = await extractRowItem(firstRow);
  if (!matchesExpectedRow(expectedItem, actualItem)) {
    throw new Error(
      `Top Watch Later row did not match expected source item '${expectedItem.sourceIndex}'. Expected '${describeItem(expectedItem)}', saw '${describeItem(actualItem)}'`
    );
  }

  const menuButton = firstRow.locator(ROW_MENU_BUTTON_SELECTOR).filter({ visible: true }).first();
  await menuButton.click({ timeout: 10_000 });

  const removeMenuItem = await findVisibleRemoveMenuItem(page);
  await removeMenuItem.click({ timeout: 10_000 });
  await waitForRemovalEvidence(page, expectedItem);
}

export async function getWatchLaterRowCount(page: Page): Promise<number> {
  return page.locator(ROW_SELECTOR).count();
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

  const expectedTitle = normalizeText(expected.title);
  const actualTitle = normalizeText(actual.title);

  if (expectedTitle && actualTitle) {
    return expectedTitle === actualTitle;
  }

  return expected.unavailableKind === actual.unavailableKind;
}

function normalizeText(value: string | null): string | null {
  return value ? value.replace(/\s+/g, " ").trim().toLowerCase() : null;
}

function describeItem(item: InventoryItem): string {
  return item.videoId ?? item.title ?? `${item.unavailableKind} item`;
}

async function findVisibleRemoveMenuItem(page: Page): Promise<Locator> {
  const candidates = [
    page.getByRole("menuitem", { name: /remove from watch later/i }).filter({ visible: true }).first(),
    page.getByRole("option", { name: /remove from watch later/i }).filter({ visible: true }).first(),
    page.locator(REMOVE_MENU_ITEM_SELECTOR).filter({ hasText: /Remove from Watch later/i }).filter({ visible: true }).first()
  ];

  for (const candidate of candidates) {
    if (await candidate.count()) {
      await candidate.waitFor({ state: "visible", timeout: 10_000 });
      return candidate;
    }
  }

  throw new Error("Remove from Watch later action was not visible in the row menu");
}

async function waitForRemovalEvidence(page: Page, expectedItem: InventoryItem): Promise<void> {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const rowCount = await page.locator(ROW_SELECTOR).count();
    if (rowCount === 0) {
      return;
    }

    const firstRow = page.locator(ROW_SELECTOR).first();
    const actualItem = await extractRowItem(firstRow).catch(() => null);
    if (actualItem && !matchesExpectedRow(expectedItem, actualItem)) {
      return;
    }

    await page.waitForTimeout(300);
  }

  throw new Error(`Removal evidence was not observed for '${describeItem(expectedItem)}'`);
}
