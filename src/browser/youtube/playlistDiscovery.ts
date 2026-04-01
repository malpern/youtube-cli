import type { Page } from "playwright";

const PLAYLISTS_FEED_PATH = "/feed/playlists";
const PLAYLIST_CARD_SELECTOR = "ytd-rich-item-renderer";
const PLAYLIST_COUNT_PATTERN = /^([\d,]+)\s+(videos?|lessons?)$/i;

export interface PlaylistFeedSummary {
  playlistId: string | null;
  title: string;
  visibility: string | null;
  videoCount: number | null;
  playlistUrl: string | null;
}

export async function resolvePlaylistFeedSummary(
  page: Page,
  youtubeBaseUrl: string,
  target: {
    playlistId?: string;
    playlistName?: string;
  }
): Promise<PlaylistFeedSummary | null> {
  const summaries = await listPlaylistFeedSummaries(page, youtubeBaseUrl);

  if (target.playlistId) {
    const byId = summaries.find((summary) => summary.playlistId === target.playlistId);
    if (byId) {
      return byId;
    }
  }

  if (target.playlistName) {
    return summaries.find((summary) => summary.title === target.playlistName) ?? null;
  }

  return null;
}

export async function listPlaylistFeedSummaries(
  page: Page,
  youtubeBaseUrl: string
): Promise<PlaylistFeedSummary[]> {
  await page.goto(`${youtubeBaseUrl}${PLAYLISTS_FEED_PATH}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await loadVisiblePlaylistFeed(page);

  return page.locator(PLAYLIST_CARD_SELECTOR).evaluateAll((cards) => {
    return cards
      .map((card) => {
        const text = (card.textContent || "").replace(/\s+/g, " ").trim();
        const anchors = Array.from(card.querySelectorAll("a"))
          .map((anchor) => ({
            text: (anchor.textContent || "").replace(/\s+/g, " ").trim(),
            href: (anchor as HTMLAnchorElement).href || null
          }))
          .filter((anchor) => anchor.text.length > 0 && anchor.href);

        const playlistLink =
          anchors.find(
            (anchor) =>
              anchor.href?.includes("/playlist?list=") && /^View full (playlist|course)$/i.test(anchor.text)
          ) ?? anchors.find((anchor) => anchor.href?.includes("/playlist?list="));
        const titleLink = anchors.find((anchor) => {
          if (!anchor.href?.includes("list=")) {
            return false;
          }

          if (/^([\d,]+)\s+(videos?|lessons?)$/i.test(anchor.text)) {
            return false;
          }

          if (/^View full (playlist|course)$/i.test(anchor.text)) {
            return false;
          }

          if (/^(Private|Public|Unlisted|Playlist|Course)$/i.test(anchor.text)) {
            return false;
          }

          return true;
        });

        const countText =
          anchors.find((anchor) => /^([\d,]+)\s+(videos?|lessons?)$/i.test(anchor.text))?.text ??
          text.match(/\b([\d,]+)\s+(videos?|lessons?)\b/i)?.[0] ??
          null;
        const countMatch = countText?.match(/^([\d,]+)\s+(videos?|lessons?)$/i) ?? null;
        const visibilityMatch = text.match(/\b(Private|Public|Unlisted)\b/i);
        const playlistUrl = playlistLink?.href ?? null;
        let playlistId: string | null = null;
        if (playlistUrl) {
          try {
            playlistId = new URL(playlistUrl).searchParams.get("list");
          } catch {
            playlistId = null;
          }
        }
        const videoCountText = countMatch?.[1];

        return {
          playlistId,
          title: titleLink?.text ?? null,
          visibility: visibilityMatch?.[1] ?? null,
          videoCount: videoCountText ? Number.parseInt(videoCountText.replace(/,/g, ""), 10) : null,
          playlistUrl
        };
      })
      .filter((summary): summary is PlaylistFeedSummary => summary.title !== null);
  });
}

export async function resolvePlaylistPageUrlByName(
  page: Page,
  youtubeBaseUrl: string,
  playlistName: string
): Promise<string | null> {
  const match = await resolvePlaylistFeedSummary(page, youtubeBaseUrl, {
    playlistName
  });
  return match?.playlistUrl ?? null;
}

async function loadVisiblePlaylistFeed(page: Page): Promise<void> {
  let previousCount = -1;
  let stablePasses = 0;

  for (let pass = 0; pass < 20; pass += 1) {
    const currentCount = await page.locator(PLAYLIST_CARD_SELECTOR).count();
    if (currentCount > 0 && currentCount === previousCount) {
      stablePasses += 1;
    } else {
      stablePasses = 0;
    }

    if (stablePasses >= 2) {
      break;
    }

    previousCount = currentCount;
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await page.waitForTimeout(500);
  }
}
