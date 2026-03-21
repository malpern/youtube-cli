import type { Page } from "playwright";

const PLAYLISTS_FEED_PATH = "/feed/playlists";

export async function resolvePlaylistPageUrlByName(
  page: Page,
  youtubeBaseUrl: string,
  playlistName: string
): Promise<string | null> {
  await page.goto(`${youtubeBaseUrl}${PLAYLISTS_FEED_PATH}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  const links = await page.locator("a").evaluateAll((anchors) => {
    return anchors
      .map((anchor) => ({
        text: (anchor.textContent || "").replace(/\s+/g, " ").trim(),
        href: (anchor as HTMLAnchorElement).href || null
      }))
      .filter((row) => row.text.length > 0 && row.href);
  });

  const match = links.find((link) => link.text === playlistName);
  if (!match?.href) {
    return null;
  }

  const listId = extractListId(match.href);
  if (!listId) {
    return null;
  }

  return `${youtubeBaseUrl}/playlist?list=${listId}`;
}

function extractListId(urlLike: string): string | null {
  try {
    const parsed = new URL(urlLike);
    return parsed.searchParams.get("list");
  } catch {
    return null;
  }
}
