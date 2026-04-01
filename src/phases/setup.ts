import fs from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { launchBrowserSession } from "../browser/launch.js";
import { ensurePlaylistExistsFromVideo } from "../browser/youtube/saveToPlaylist.js";
import { resolveTargetPlaylistForSavePanel, getTargetPlaylistRequest } from "../services/targetPlaylist.js";
import { AuthenticationRequiredError, assertAuthenticatedYouTubeSession, throwIfAuthenticationLost } from "../services/authGuard.js";
import { pauseRunForAuthentication } from "../services/authPause.js";

async function getFirstWatchLaterVideoUrl(page: import("playwright").Page, watchLaterUrl: string): Promise<string> {
  await page.goto(watchLaterUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  const href = await page.locator("ytd-playlist-video-renderer a#video-title").first().getAttribute("href");
  if (!href) {
    throw new Error("Could not find the first Watch Later video URL");
  }

  return href.startsWith("http") ? href : new URL(href, "https://www.youtube.com").toString();
}

export async function runSetup(command: Command): Promise<void> {
  const ctx = createRunContext(command, "setup");
  const localOptions = command.opts<{ targetPlaylist?: string; targetPlaylistId?: string }>();
  const targetRequest = getTargetPlaylistRequest(localOptions);
  const targetPlaylist = targetRequest.targetPlaylist;
  const targetPlaylistId = targetRequest.targetPlaylistId;
  const watchLaterUrl = `${ctx.config.youtubeBaseUrl}/playlist?list=WL`;
  const setupPath = path.join(ctx.artifacts.runDir, "setup.json");
  const screenshotPath = path.join(ctx.artifacts.screenshotsDir, "setup-save-panel.png");

  const session = await launchBrowserSession(ctx.config);

  try {
    await assertAuthenticatedYouTubeSession(session.page, ctx.config, "setup.start", { navigate: true });
    const firstVideoUrl = await getFirstWatchLaterVideoUrl(session.page, watchLaterUrl);
    const target = await resolveTargetPlaylistForSavePanel(session.page, ctx.config.youtubeBaseUrl, targetRequest);
    const resolvedTargetPlaylist = target.title;
    ctx.logEvent("setup", "info", "setup.source-video", "Resolved first Watch Later video", {
      firstVideoUrl,
      targetPlaylist: resolvedTargetPlaylist,
      targetPlaylistId
    });

    const outcome = await ensurePlaylistExistsFromVideo(session.page, firstVideoUrl, target, async () => {
      await assertAuthenticatedYouTubeSession(session.page, ctx.config, "setup.open-save-panel");
    });
    await session.page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);

    const payload = {
      targetPlaylist: resolvedTargetPlaylist,
      targetPlaylistId,
      firstVideoUrl,
      outcome,
      screenshotPath
    };

    fs.writeFileSync(setupPath, `${JSON.stringify(payload, null, 2)}\n`);
    ctx.saveCheckpoint("setup", payload);
    ctx.logEvent("setup", "info", "setup.complete", "Setup completed", payload);
    ctx.db.upsertRunState("setup", "complete");
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      pauseRunForAuthentication({
        ctx,
        phase: "setup",
        error,
        payload: {
          targetPlaylist,
          targetPlaylistId
        }
      });
      return;
    }

    try {
      await throwIfAuthenticationLost(session.page, ctx.config, "setup.failed", error);
    } catch (authError) {
      if (authError instanceof AuthenticationRequiredError) {
        pauseRunForAuthentication({
          ctx,
          phase: "setup",
          error: authError,
          payload: {
            targetPlaylist,
            targetPlaylistId
          }
        });
        return;
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    await session.page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
    ctx.logEvent("setup", "error", "setup.failed", "Setup failed", { error: message, targetPlaylist, targetPlaylistId });
    ctx.db.upsertRunState("setup", "failed");
    throw error;
  } finally {
    await session.close();
  }
}
