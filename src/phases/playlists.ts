import fs from "node:fs";
import path from "node:path";

import type { Command } from "commander";
import type { Page } from "playwright";

import { createRunContext } from "../app/runContext.js";
import { launchBrowserSession } from "../browser/launch.js";
import { listPlaylistFeedSummaries } from "../browser/youtube/playlistDiscovery.js";
import { listVisiblePlaylistOptions, openSaveToPlaylistPanel } from "../browser/youtube/saveToPlaylist.js";
import { buildPlaylistMetadataIndex, resolvePlaylistMetadata } from "../services/playlistMetadata.js";

interface PlaylistsOptions {
  json?: boolean;
}

interface WatchLaterCapacitySummary {
  videoCount: number | null;
  maxItems: number;
  remainingCapacity: number | null;
  nearCapacity: boolean;
  atCapacity: boolean;
}

function writeJson(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function getFirstWatchLaterVideoUrl(page: Page, watchLaterUrl: string): Promise<string> {
  await page.goto(watchLaterUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  const href = await page.locator("ytd-playlist-video-renderer a#video-title").first().getAttribute("href");
  if (!href) {
    throw new Error("Could not find the first Watch Later video URL");
  }

  return href.startsWith("http") ? href : new URL(href, "https://www.youtube.com").toString();
}

async function getWatchLaterCapacitySummary(page: Page): Promise<WatchLaterCapacitySummary> {
  const maxItems = 5_000;
  const headerTexts = await page
    .locator("#stats yt-formatted-string, ytd-playlist-byline-renderer yt-formatted-string, #stats")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
        .filter((text) => text.length > 0)
    )
    .catch(() => [] as string[]);

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const searchText = [...headerTexts, bodyText].join(" ");
  const countMatch = searchText.match(/([\d,]+)\s+videos?/i);
  const videoCountText = countMatch?.[1];
  const videoCount = videoCountText ? Number.parseInt(videoCountText.replace(/,/g, ""), 10) : null;
  const remainingCapacity = videoCount === null ? null : Math.max(maxItems - videoCount, 0);
  const atCapacity = videoCount !== null && videoCount >= maxItems;
  const nearCapacity = videoCount !== null && videoCount >= Math.floor(maxItems * 0.9) && !atCapacity;

  return {
    videoCount,
    maxItems,
    remainingCapacity,
    nearCapacity,
    atCapacity
  };
}

export async function runPlaylists(command: Command): Promise<void> {
  const localOptions = command.opts<PlaylistsOptions>();
  const json = Boolean(localOptions.json);
  const ctx = createRunContext(command, "playlists", json ? { consoleStream: process.stderr } : {});
  const watchLaterUrl = `${ctx.config.youtubeBaseUrl}/playlist?list=WL`;
  const outputPath = path.join(ctx.artifacts.runDir, "playlists.json");
  const screenshotPath = path.join(ctx.artifacts.screenshotsDir, "playlists-save-panel.png");
  const session = await launchBrowserSession(ctx.config);

  try {
    const seedVideoUrl = await getFirstWatchLaterVideoUrl(session.page, watchLaterUrl);
    const watchLater = await getWatchLaterCapacitySummary(session.page);
    const playlistFeedSummaries = await listPlaylistFeedSummaries(session.page, ctx.config.youtubeBaseUrl);
    const playlistMetadata = buildPlaylistMetadataIndex(playlistFeedSummaries);
    await openSaveToPlaylistPanel(session.page, seedVideoUrl);
    const playlists = (await listVisiblePlaylistOptions(session.page))
      .map((playlist) => {
        const metadata = resolvePlaylistMetadata(playlistMetadata, playlist.title, playlist.visibility);
        return {
          playlistId: metadata?.playlistId ?? null,
          title: playlist.title,
          visibility: playlist.visibility,
          selected: playlist.pressed,
          videoCount: metadata?.videoCount ?? null
        };
      })
      .sort((left, right) => left.title.localeCompare(right.title));

    await session.page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
    await session.page.keyboard.press("Escape").catch(() => undefined);

    const payload = {
      ok: true,
      runId: ctx.runId,
      fetchedAt: new Date().toISOString(),
      watchLaterUrl,
      seedVideoUrl,
      watchLater,
      defaultNewPlaylistName: "Old Watch",
      playlists,
      artifacts: {
        runDir: ctx.artifacts.runDir,
        outputPath,
        screenshotPath
      }
    };

    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
    ctx.saveCheckpoint("playlists", {
      outputPath,
      playlistCount: playlists.length,
      playlistFeedCount: playlistFeedSummaries.length,
      seedVideoUrl
    });
    ctx.logEvent("playlists", "info", "playlists.complete", "Playlist discovery completed", {
      outputPath,
      playlistCount: playlists.length,
      playlistFeedCount: playlistFeedSummaries.length,
      seedVideoUrl,
      screenshotPath
    });
    ctx.db.upsertRunState("playlists", "complete");

    if (json) {
      writeJson(payload);
      return;
    }

    console.log(`Discovered ${playlists.length} playlists in the save panel.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await session.page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
    ctx.logEvent("playlists", "error", "playlists.failed", "Playlist discovery failed", {
      error: message,
      screenshotPath
    });
    ctx.db.upsertRunState("playlists", "failed");

    if (json) {
      writeJson({
        ok: false,
        runId: ctx.runId,
        error: message,
        artifacts: {
          runDir: ctx.artifacts.runDir,
          screenshotPath
        }
      });
      process.exitCode = 1;
      return;
    }

    throw error;
  } finally {
    await session.close();
  }
}
