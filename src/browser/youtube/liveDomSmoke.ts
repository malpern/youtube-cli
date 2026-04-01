import fs from "node:fs";
import path from "node:path";

import { captureAccountSnapshot, accountMatches } from "../accountCheck.js";
import { launchBrowserSession } from "../launch.js";
import { loadConfig } from "../../config/loadConfig.js";
import { loadWatchLaterInventory } from "./inventory.js";
import { probeWatchLaterSelectors } from "./selectorProbe.js";
import { listVisiblePlaylistOptions, openSaveToPlaylistPanel } from "./saveToPlaylist.js";
import { ensureDir } from "../../utils/filesystem.js";

interface CheckResult {
  name: string;
  ok: boolean;
  details?: Record<string, unknown>;
  error?: string;
}

interface SmokeState {
  sampleVideoUrl: string | null;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function resolveLiveDomConfigPath(rootDir: string): string {
  const configuredPath = process.env.YOUTUBE_WATCHLIST_CONFIG;
  const resolvedPath = configuredPath
    ? path.resolve(rootDir, configuredPath)
    : path.join(rootDir, "config.local.json");

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      configuredPath
        ? `Live DOM smoke config was not found at ${resolvedPath}`
        : "Live DOM smoke tests require config.local.json or YOUTUBE_WATCHLIST_CONFIG. Copy config.example.json and point it at an authenticated browser session."
    );
  }

  return resolvedPath;
}

function createArtifactPaths(rootDir: string): {
  runDir: string;
  screenshotDir: string;
  reportPath: string;
} {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = ensureDir(path.join(rootDir, "runs", `live-dom-smoke-${stamp}`));
  const screenshotDir = ensureDir(path.join(runDir, "screenshots"));

  return {
    runDir,
    screenshotDir,
    reportPath: path.join(runDir, "report.json")
  };
}

function sanitizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const configPath = resolveLiveDomConfigPath(rootDir);
  const config = loadConfig(configPath);

  assertCondition(
    config.browserCdpUrl || config.profileDir || config.storageStatePath,
    "Live DOM smoke tests require browserCdpUrl, profileDir, or storageStatePath in the selected config."
  );

  const artifacts = createArtifactPaths(rootDir);
  const watchLaterUrl = `${config.youtubeBaseUrl}/playlist?list=WL`;
  const state: SmokeState = {
    sampleVideoUrl: null
  };
  const results: CheckResult[] = [];

  console.log(`Using live DOM smoke config: ${configPath}`);
  console.log(`Writing live DOM smoke artifacts to: ${artifacts.runDir}`);

  const session = await launchBrowserSession(config);

  const persistResults = () => {
    fs.writeFileSync(
      artifacts.reportPath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          configPath,
          artifactDir: artifacts.runDir,
          results
        },
        null,
        2
      )}\n`
    );
  };

  const runCheck = async (
    name: string,
    fn: (page: import("playwright").Page) => Promise<Record<string, unknown> | undefined>
  ): Promise<void> => {
    const page = await session.context.newPage();

    try {
      const details = await fn(page);
      results.push({
        name,
        ok: true,
        ...(details ? { details } : {})
      });
      persistResults();
      console.log(`PASS ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        name,
        ok: false,
        error: message
      });

      const screenshotPath = path.join(
        artifacts.screenshotDir,
        `${sanitizeName(name) || "live-dom-smoke-failure"}.png`
      );

      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
      persistResults();
      console.error(`FAIL ${name}: ${message}`);
      console.error(`Failure screenshot: ${screenshotPath}`);
      throw error;
    } finally {
      await page.close().catch(() => undefined);
    }
  };

  try {
    await runCheck("youtube-auth", async (page) => {
      const snapshot = await captureAccountSnapshot(page, config.youtubeBaseUrl);

      assertCondition(snapshot.signedIn, "Expected an authenticated YouTube session, but the browser looked signed out.");
      assertCondition(snapshot.accountLabel, "Expected a visible signed-in account label on YouTube.");
      assertCondition(
        accountMatches(config.expectedAccount, snapshot),
        config.expectedAccount
          ? `Signed-in YouTube account did not match expectedAccount '${config.expectedAccount}'. Saw '${snapshot.accountLabel ?? "unknown"}'.`
          : "Signed-in YouTube account could not be verified."
      );

      return {
        accountLabel: snapshot.accountLabel,
        currentUrl: snapshot.currentUrl,
        pageTitle: snapshot.pageTitle
      };
    });

    await runCheck("watch-later-selectors", async (page) => {
      const report = await probeWatchLaterSelectors(page, watchLaterUrl);
      const playlistVideoRendererCount = report.selectorCounts.playlistVideoRenderer ?? 0;

      assertCondition(
        playlistVideoRendererCount > 0,
        "Watch Later probe found zero ytd-playlist-video-renderer rows."
      );
      assertCondition(report.signInLinkCount === 0, "Watch Later probe found a Sign in link, which indicates auth was lost.");
      assertCondition(report.menuProbe?.opened, "Watch Later probe could not open the row action menu.");
      assertCondition(
        report.menuProbe?.itemTexts.some((text) => /remove from watch later/i.test(text)),
        "Watch Later row action menu did not expose a Remove from Watch later action."
      );

      return {
        selectorCounts: report.selectorCounts,
        menuButtonSelector: report.menuProbe?.buttonSelector ?? null,
        menuItemCount: report.menuProbe?.itemCount ?? 0
      };
    });

    await runCheck("watch-later-inventory", async (page) => {
      const inventory = await loadWatchLaterInventory(page, watchLaterUrl, {
        maxNoGrowthPasses: 1,
        settleMs: 750,
        maxItems: 12
      });

      assertCondition(inventory.items.length > 0, "Watch Later inventory returned zero items.");

      const playableItem = inventory.items.find((item) => typeof item.videoUrl === "string" && item.videoUrl.length > 0);

      assertCondition(
        playableItem,
        "Watch Later inventory did not extract any playable video URLs from the first 12 rows."
      );
      assertCondition(playableItem.title, "A playable Watch Later row was missing its title text.");
      assertCondition(playableItem.videoId, "A playable Watch Later row was missing its video id.");

      state.sampleVideoUrl = playableItem.videoUrl;

      return {
        itemCount: inventory.items.length,
        sampledTitle: playableItem.title,
        sampledVideoId: playableItem.videoId
      };
    });

    await runCheck("watch-page-save-panel", async (page) => {
      assertCondition(state.sampleVideoUrl, "No sample Watch Later video URL was available for the save panel smoke test.");

      const timings = await openSaveToPlaylistPanel(page, state.sampleVideoUrl);

      const playlistOptions = await listVisiblePlaylistOptions(page);
      assertCondition(playlistOptions.length > 0, "Watch-page Save panel opened, but no playlist options were visible.");

      await page.keyboard.press("Escape").catch(() => undefined);

      return {
        playlistOptionCount: playlistOptions.length,
        firstPlaylistTitle: playlistOptions[0]?.title ?? null,
        timings
      };
    });

    console.log("Live DOM smoke suite passed.");
  } finally {
    persistResults();
    await session.close().catch(() => undefined);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
