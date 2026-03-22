import type { Page } from "playwright";

export interface PlaylistOption {
  domIndex: number;
  title: string;
  visibility: string | null;
  pressed: boolean;
}

export interface PlaylistTarget {
  title: string;
  visibility?: string | null;
  playlistId?: string;
}

export type SaveToPlaylistResult = "already-saved" | "saved";

export interface SaveToPlaylistTimings {
  gotoMs: number;
  readyUiMs: number;
  entryPointMs: number;
  panelVisibleMs: number;
  selectionMs: number;
  reopenConfirmMs: number;
  totalMs: number;
}

export interface SaveToPlaylistResponse {
  result: SaveToPlaylistResult;
  timings: SaveToPlaylistTimings;
}

const MORE_ACTIONS_BUTTON_SELECTOR = "#actions button[aria-label='More actions'], button[aria-label='More actions']";
const MORE_ACTIONS_MENU_ITEM_SELECTOR = "ytd-menu-service-item-renderer, tp-yt-paper-item";
const PLAYLIST_BUTTON_SELECTOR = "button.ytButtonOrAnchorHost, button.ytButtonOrAnchorButton";
const NEW_PLAYLIST_BUTTON_SELECTOR = "button[aria-label='Create new playlist']";
const CREATE_BUTTON_SELECTOR = "button[aria-label='Create']";
const TITLE_TEXTAREA_SELECTOR = "textarea[placeholder='Choose a title']";
const CREATE_DIALOG_SELECTOR = "tp-yt-paper-dialog[role='dialog']";

export async function openSaveToPlaylistPanel(
  page: Page,
  videoUrl: string,
  authCheck?: () => Promise<void>
): Promise<Pick<SaveToPlaylistTimings, "gotoMs" | "readyUiMs" | "entryPointMs" | "panelVisibleMs">> {
  const gotoStartedAt = Date.now();
  await page.goto(videoUrl, { waitUntil: "domcontentloaded" });
  const gotoMs = Date.now() - gotoStartedAt;
  await authCheck?.();

  const readyUiStartedAt = Date.now();
  await waitForSaveReadyUi(page);
  const readyUiMs = Date.now() - readyUiStartedAt;

  const entryPointStartedAt = Date.now();
  await clickSaveEntryPoint(page);
  const entryPointMs = Date.now() - entryPointStartedAt;

  const panelVisibleStartedAt = Date.now();
  await page.locator(NEW_PLAYLIST_BUTTON_SELECTOR).first().waitFor({ state: "visible", timeout: 10_000 });
  const panelVisibleMs = Date.now() - panelVisibleStartedAt;

  return {
    gotoMs,
    readyUiMs,
    entryPointMs,
    panelVisibleMs
  };
}

export async function listVisiblePlaylistOptions(page: Page): Promise<PlaylistOption[]> {
  const options = await page.locator(PLAYLIST_BUTTON_SELECTOR).evaluateAll((buttons) => {
    return buttons
      .map((button, domIndex) => {
        const text = (button.textContent || "").replace(/\s+/g, " ").trim();
        if (text.length === 0) {
          return null;
        }
        const match = text.match(/^(.*?)(Private|Public|Unlisted)$/);

        return {
          domIndex,
          title: match?.[1]?.trim() || text,
          visibility: match?.[2] ?? null,
          pressed: button.getAttribute("aria-pressed") === "true"
        };
      })
      .filter((option): option is PlaylistOption => option !== null);
  });

  return options;
}

export async function playlistExists(page: Page, target: PlaylistTarget): Promise<boolean> {
  const options = await listVisiblePlaylistOptions(page);
  return findMatchingPlaylistOption(options, target) !== null;
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

export async function ensurePlaylistExistsFromVideo(
  page: Page,
  videoUrl: string,
  target: PlaylistTarget,
  authCheck?: () => Promise<void>
): Promise<"existing" | "created"> {
  await openSaveToPlaylistPanel(page, videoUrl, authCheck);

  if (await playlistExists(page, target)) {
    await page.keyboard.press("Escape").catch(() => undefined);
    return "existing";
  }

  if (target.playlistId) {
    throw new Error(
      `Playlist '${target.title}' (${target.playlistId}) was not found in the save panel. Refusing to fall back to title-based creation.`
    );
  }

  await createPlaylistFromSavePanel(page, target.title);
  await openSaveToPlaylistPanel(page, videoUrl, authCheck);

  if (!(await playlistExists(page, target))) {
    throw new Error(`Playlist '${target.title}' was not found after reopening the save panel`);
  }

  await page.keyboard.press("Escape").catch(() => undefined);
  return "created";
}

export async function ensureVideoSavedToPlaylist(
  page: Page,
  videoUrl: string,
  target: PlaylistTarget,
  authCheck?: () => Promise<void>
): Promise<SaveToPlaylistResponse> {
  const totalStartedAt = Date.now();
  const panelTimings = await openSaveToPlaylistPanel(page, videoUrl, authCheck);

  const playlistButton = await getPlaylistButtonForTarget(page, target);
  await playlistButton.waitFor({ state: "visible", timeout: 10_000 });

  const beforePressed = await playlistButton.getAttribute("aria-pressed");
  if (beforePressed === "true") {
    await page.keyboard.press("Escape").catch(() => undefined);
    return {
      result: "already-saved",
      timings: {
        ...panelTimings,
        selectionMs: 0,
        reopenConfirmMs: 0,
        totalMs: Date.now() - totalStartedAt
      }
    };
  }

  await playlistButton.click({ force: true, timeout: 10_000 });
  const selectionStartedAt = Date.now();
  const selected = await waitForPlaylistSelection(page, target);
  const selectionMs = Date.now() - selectionStartedAt;
  if (!selected) {
    await page.keyboard.press("Escape").catch(() => undefined);
    const reopenConfirmStartedAt = Date.now();
    await openSaveToPlaylistPanel(page, videoUrl, authCheck);
    const reopenedButton = await getPlaylistButtonForTarget(page, target);
    const reopenedPressed = await reopenedButton.getAttribute("aria-pressed").catch(() => null);
    await page.keyboard.press("Escape").catch(() => undefined);
    const reopenConfirmMs = Date.now() - reopenConfirmStartedAt;

    if (reopenedPressed !== "true") {
      throw new Error(`Playlist '${target.title}' did not become selected after clicking`);
    }

    return {
      result: "saved",
      timings: {
        ...panelTimings,
        selectionMs,
        reopenConfirmMs,
        totalMs: Date.now() - totalStartedAt
      }
    };
  }

  await page.keyboard.press("Escape").catch(() => undefined);
  return {
    result: "saved",
    timings: {
      ...panelTimings,
      selectionMs,
      reopenConfirmMs: 0,
      totalMs: Date.now() - totalStartedAt
    }
  };
}

async function waitForPlaylistSelection(page: Page, target: PlaylistTarget): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const playlistButton = await getPlaylistButtonForTarget(page, target).catch(() => null);
    const attr = await playlistButton?.getAttribute("aria-pressed").catch(() => null);

    if (attr === "true") {
      return true;
    }

    await page.waitForTimeout(300);
  }

  return false;
}

async function getPlaylistButtonForTarget(page: Page, target: PlaylistTarget) {
  const options = await listVisiblePlaylistOptions(page);
  const match = findMatchingPlaylistOption(options, target);
  if (!match) {
    throw new Error(buildPlaylistNotFoundMessage(target));
  }

  return page.locator(PLAYLIST_BUTTON_SELECTOR).nth(match.domIndex);
}

function findMatchingPlaylistOption(options: PlaylistOption[], target: PlaylistTarget): PlaylistOption | null {
  const exactTitleMatches = options.filter((option) => option.title === target.title);
  const visibilityFiltered =
    target.visibility !== undefined && target.visibility !== null
      ? exactTitleMatches.filter((option) => option.visibility === target.visibility)
      : exactTitleMatches;

  if (visibilityFiltered.length === 1) {
    return visibilityFiltered[0] ?? null;
  }

  if (visibilityFiltered.length > 1) {
    throw new Error(buildAmbiguousPlaylistMessage(target, visibilityFiltered));
  }

  if (target.visibility !== undefined && target.visibility !== null && exactTitleMatches.length > 1) {
    throw new Error(buildAmbiguousPlaylistMessage(target, exactTitleMatches));
  }

  return exactTitleMatches.length === 1 ? (exactTitleMatches[0] ?? null) : null;
}

function buildPlaylistNotFoundMessage(target: PlaylistTarget): string {
  const visibilitySuffix = target.visibility ? ` (${target.visibility})` : "";
  const idSuffix = target.playlistId ? ` [${target.playlistId}]` : "";
  return `Playlist '${target.title}'${visibilitySuffix}${idSuffix} was not found in the save panel`;
}

function buildAmbiguousPlaylistMessage(target: PlaylistTarget, options: PlaylistOption[]): string {
  const renderedOptions = options.map((option) => `${option.title} (${option.visibility ?? "Unknown"})`).join(", ");
  const visibilitySuffix = target.visibility ? ` with visibility '${target.visibility}'` : "";
  const idSuffix = target.playlistId ? ` [${target.playlistId}]` : "";
  const idLimitation =
    target.playlistId
      ? " The YouTube save panel does not expose playlist ids in its DOM, so the selection cannot be disambiguated beyond title and visibility."
      : "";
  return `Playlist '${target.title}'${visibilitySuffix}${idSuffix} matched multiple save-panel options: ${renderedOptions}.${idLimitation}`;
}

async function findVisibleSaveMenuItem(page: Page) {
  const candidates = [
    page.getByRole("menuitem", { name: /^Save(?: to playlist)?$/ }).filter({ visible: true }).first(),
    page.getByRole("option", { name: /^Save(?: to playlist)?$/ }).filter({ visible: true }).first(),
    page.locator(MORE_ACTIONS_MENU_ITEM_SELECTOR).filter({ hasText: /^Save(?: to playlist)?$/ }).filter({ visible: true }).first()
  ];

  for (const candidate of candidates) {
    if (await candidate.count()) {
      await candidate.waitFor({ state: "visible", timeout: 10_000 });
      return candidate;
    }
  }

  throw new Error("Save action was not visible in the More actions menu");
}

async function clickSaveEntryPoint(page: Page): Promise<void> {
  const deadline = Date.now() + 8_000;

  while (Date.now() < deadline) {
    const visibleSaveButton = await findVisibleSaveButton(page);
    if (visibleSaveButton) {
      await visibleSaveButton.click({ timeout: 10_000 });
      return;
    }

    const moreActionsButton = page.locator(MORE_ACTIONS_BUTTON_SELECTOR).filter({ visible: true }).first();
    if (await moreActionsButton.count()) {
      await moreActionsButton.click({ timeout: 10_000 });

      const saveMenuItem = await findVisibleSaveMenuItem(page).catch(() => null);
      if (saveMenuItem) {
        await saveMenuItem.click({ timeout: 10_000 });
        return;
      }

      await page.keyboard.press("Escape").catch(() => undefined);
    }

    await page.waitForTimeout(400);
  }

  throw new Error("Save action was not visible on the watch page");
}

async function waitForSaveReadyUi(page: Page): Promise<void> {
  const candidates = [
    page.locator("#actions").first(),
    page.locator("h1").first(),
    page.getByRole("button", { name: /^Save(?: to playlist)?$/ }).first(),
    page.locator(MORE_ACTIONS_BUTTON_SELECTOR).first()
  ];

  await Promise.any(
    candidates.map((candidate) =>
      candidate.waitFor({
        state: "visible",
        timeout: 6_000
      })
    )
  ).catch(() => undefined);
}

async function findVisibleSaveButton(page: Page) {
  const candidates = [
    page.locator("#actions").getByRole("button", { name: /^Save(?: to playlist)?$/ }).filter({ visible: true }).first(),
    page.getByRole("button", { name: /^Save(?: to playlist)?$/ }).filter({ visible: true }).first(),
    page.locator("#actions button[aria-label='Save to playlist'], button[aria-label='Save to playlist']").filter({ visible: true }).first(),
    page.locator("#actions button[aria-label='Save'], button[aria-label='Save']").filter({ visible: true }).first()
  ];

  for (const candidate of candidates) {
    if (await candidate.count()) {
      await candidate.waitFor({ state: "visible", timeout: 10_000 });
      return candidate;
    }
  }

  return null;
}
