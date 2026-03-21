import type { Page } from "playwright";

import type { ProbeReport } from "../../models/types.js";

const SELECTORS: Record<string, string> = {
  playlistVideoRenderer: "ytd-playlist-video-renderer",
  playlistPanelVideoRenderer: "ytd-playlist-panel-video-renderer",
  menuButton: "button[aria-label*='Action menu'], yt-icon-button.dropdown-trigger button, ytd-menu-renderer button",
  playlistCheckboxLabel: "tp-yt-paper-checkbox",
  addToPlaylistMenuItem: "ytd-menu-service-item-renderer",
  removeWatchLaterMenuItem: "ytd-menu-service-item-renderer"
};

export async function probeWatchLaterSelectors(page: Page, watchLaterUrl: string): Promise<ProbeReport> {
  await page.goto(watchLaterUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  const selectorCounts = Object.fromEntries(
    await Promise.all(
      Object.entries(SELECTORS).map(async ([name, selector]) => [name, await page.locator(selector).count()] as const)
    )
  );

  const accountButton = page.locator("button#avatar-btn");
  const signInLink = page.getByRole("link", { name: /sign in/i });
  const bodyTextSample = await page.locator("body").innerText().catch(() => "");
  const menuProbe = await probeActionMenu(page);

  return {
    currentUrl: page.url(),
    title: await page.title(),
    accountLabel: (await accountButton.first().getAttribute("aria-label").catch(() => null)) ?? null,
    selectorCounts,
    bodyTextSample: bodyTextSample.slice(0, 2_000),
    signInLinkCount: await signInLink.count(),
    ...(menuProbe ? { menuProbe } : {})
  };
}

async function probeActionMenu(page: Page): Promise<ProbeReport["menuProbe"]> {
  const candidates = [
    "ytd-playlist-video-renderer #button[aria-label]",
    "ytd-playlist-video-renderer yt-icon-button#button button",
    "ytd-playlist-video-renderer ytd-menu-renderer yt-icon-button button",
    "ytd-playlist-video-renderer button[aria-label*='Action menu']",
    "ytd-playlist-video-renderer button[aria-label*='More actions']"
  ];

  for (const selector of candidates) {
    const button = page.locator(selector).first();
    if ((await button.count()) === 0) {
      continue;
    }

    try {
      await button.click({ timeout: 5_000 });
      const menuItems = page.locator("tp-yt-paper-listbox ytd-menu-service-item-renderer, ytd-menu-popup-renderer ytd-menu-service-item-renderer");
      await menuItems.first().waitFor({ state: "visible", timeout: 5_000 });
      const itemTexts = (await menuItems.allInnerTexts())
        .map((text) => text.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 20);

      await page.keyboard.press("Escape").catch(() => undefined);

      return {
        opened: true,
        buttonSelector: selector,
        itemCount: itemTexts.length,
        itemTexts
      };
    } catch {
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  }

  return {
    opened: false,
    buttonSelector: null,
    itemCount: 0,
    itemTexts: []
  };
}
