import type { Page } from "playwright";

export interface PlaylistOption {
  title: string;
  visibility: string | null;
  pressed: boolean;
}

export type SaveToPlaylistResult = "already-saved" | "saved";

const SAVE_BUTTON_SELECTOR = "#actions button[aria-label='Save to playlist'], button[aria-label='Save to playlist']";
const MORE_ACTIONS_BUTTON_SELECTOR = "#actions button[aria-label='More actions'], button[aria-label='More actions']";
const MORE_ACTIONS_MENU_ITEM_SELECTOR = "ytd-menu-service-item-renderer, tp-yt-paper-item";
const PLAYLIST_BUTTON_SELECTOR = "button.ytButtonOrAnchorHost, button.ytButtonOrAnchorButton";
const NEW_PLAYLIST_BUTTON_SELECTOR = "button[aria-label='Create new playlist']";
const CREATE_BUTTON_SELECTOR = "button[aria-label='Create']";
const TITLE_TEXTAREA_SELECTOR = "textarea[placeholder='Choose a title']";
const CREATE_DIALOG_SELECTOR = "tp-yt-paper-dialog[role='dialog']";

export async function openSaveToPlaylistPanel(page: Page, videoUrl: string): Promise<void> {
  await page.goto(videoUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  const visibleSaveButton = page.locator(SAVE_BUTTON_SELECTOR).filter({ visible: true }).first();
  if (await visibleSaveButton.count()) {
    await visibleSaveButton.click({ timeout: 10_000 });
  } else {
    const moreActionsButton = page.locator(MORE_ACTIONS_BUTTON_SELECTOR).filter({ visible: true }).first();
    await moreActionsButton.click({ timeout: 10_000 });
    const saveMenuItem = await findVisibleSaveMenuItem(page);
    await saveMenuItem.click({ timeout: 10_000 });
  }

  await page.locator(NEW_PLAYLIST_BUTTON_SELECTOR).first().waitFor({ state: "visible", timeout: 10_000 });
}

export async function listVisiblePlaylistOptions(page: Page): Promise<PlaylistOption[]> {
  const options = await page.locator(PLAYLIST_BUTTON_SELECTOR).evaluateAll((buttons) => {
    return buttons
      .filter((button) => {
        const text = (button.textContent || "").replace(/\s+/g, " ").trim();
        return text.length > 0;
      })
      .map((button) => {
        const text = (button.textContent || "").replace(/\s+/g, " ").trim();
        const match = text.match(/^(.*?)(Private|Public|Unlisted)$/);

        return {
          title: match?.[1]?.trim() || text,
          visibility: match?.[2] ?? null,
          pressed: button.getAttribute("aria-pressed") === "true"
        };
      });
  });

  return options;
}

export async function playlistExists(page: Page, playlistName: string): Promise<boolean> {
  const options = await listVisiblePlaylistOptions(page);
  return options.some((option) => option.title === playlistName);
}

export async function createPlaylistFromSavePanel(page: Page, playlistName: string): Promise<void> {
  await page.locator(NEW_PLAYLIST_BUTTON_SELECTOR).first().click({ timeout: 10_000 });

  const dialog = page
    .locator(CREATE_DIALOG_SELECTOR)
    .filter({ has: page.locator(TITLE_TEXTAREA_SELECTOR).filter({ visible: true }) })
    .first();
  await dialog.waitFor({ state: "visible", timeout: 10_000 });

  const titleField = dialog.locator(TITLE_TEXTAREA_SELECTOR).filter({ visible: true }).first();
  await titleField.waitFor({ state: "visible", timeout: 10_000 });
  await titleField.fill(playlistName);

  const createButton = dialog.locator(CREATE_BUTTON_SELECTOR).filter({ visible: true }).first();
  await createButton.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(300);
  await createButton.click({ timeout: 10_000, force: true });

  await dialog.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => undefined);
  await page.getByText("Playlist created").waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
}

export async function ensurePlaylistExistsFromVideo(page: Page, videoUrl: string, playlistName: string): Promise<"existing" | "created"> {
  await openSaveToPlaylistPanel(page, videoUrl);

  if (await playlistExists(page, playlistName)) {
    await page.keyboard.press("Escape").catch(() => undefined);
    return "existing";
  }

  await createPlaylistFromSavePanel(page, playlistName);
  await openSaveToPlaylistPanel(page, videoUrl);

  if (!(await playlistExists(page, playlistName))) {
    throw new Error(`Playlist '${playlistName}' was not found after reopening the save panel`);
  }

  await page.keyboard.press("Escape").catch(() => undefined);
  return "created";
}

export async function ensureVideoSavedToPlaylist(
  page: Page,
  videoUrl: string,
  playlistName: string
): Promise<SaveToPlaylistResult> {
  await openSaveToPlaylistPanel(page, videoUrl);

  const playlistButton = page
    .locator(PLAYLIST_BUTTON_SELECTOR)
    .filter({ hasText: playlistName })
    .first();
  await playlistButton.waitFor({ state: "visible", timeout: 10_000 });

  const beforePressed = await playlistButton.getAttribute("aria-pressed");
  if (beforePressed === "true") {
    await page.keyboard.press("Escape").catch(() => undefined);
    return "already-saved";
  }

  await playlistButton.click({ force: true, timeout: 10_000 });
  const selected = await waitForPlaylistSelection(page, playlistName);
  if (!selected) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await openSaveToPlaylistPanel(page, videoUrl);
    const reopenedButton = page
      .locator(PLAYLIST_BUTTON_SELECTOR)
      .filter({ hasText: playlistName })
      .first();
    const reopenedPressed = await reopenedButton.getAttribute("aria-pressed").catch(() => null);
    await page.keyboard.press("Escape").catch(() => undefined);

    if (reopenedPressed !== "true") {
      throw new Error(`Playlist '${playlistName}' did not become selected after clicking`);
    }

    return "saved";
  }

  await page.keyboard.press("Escape").catch(() => undefined);
  return "saved";
}

async function waitForPlaylistSelection(page: Page, playlistName: string): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const attr = await page
      .locator(PLAYLIST_BUTTON_SELECTOR)
      .filter({ hasText: playlistName })
      .first()
      .getAttribute("aria-pressed")
      .catch(() => null);

    if (attr === "true") {
      return true;
    }

    await page.waitForTimeout(300);
  }

  return false;
}

async function findVisibleSaveMenuItem(page: Page) {
  const candidates = [
    page.getByRole("menuitem", { name: /^Save$/ }).filter({ visible: true }).first(),
    page.getByRole("option", { name: /^Save$/ }).filter({ visible: true }).first(),
    page.locator(MORE_ACTIONS_MENU_ITEM_SELECTOR).filter({ hasText: /^Save$/ }).filter({ visible: true }).first()
  ];

  for (const candidate of candidates) {
    if (await candidate.count()) {
      await candidate.waitFor({ state: "visible", timeout: 10_000 });
      return candidate;
    }
  }

  throw new Error("Save action was not visible in the More actions menu");
}
