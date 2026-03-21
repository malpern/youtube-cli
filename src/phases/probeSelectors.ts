import fs from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { launchBrowserSession } from "../browser/launch.js";
import { probeWatchLaterSelectors } from "../browser/youtube/selectorProbe.js";

export async function runProbeSelectors(command: Command): Promise<void> {
  const ctx = createRunContext(command, "probe-selectors");
  const watchLaterUrl = `${ctx.config.youtubeBaseUrl}/playlist?list=WL`;
  const reportPath = path.join(ctx.artifacts.runDir, "probe-selectors.json");
  const screenshotPath = path.join(ctx.artifacts.screenshotsDir, "probe-watch-later.png");
  const menuScreenshotPath = path.join(ctx.artifacts.screenshotsDir, "probe-watch-later-menu.png");

  const session = await launchBrowserSession(ctx.config);

  try {
    const report = await probeWatchLaterSelectors(session.page, watchLaterUrl);
    await session.page.screenshot({ path: screenshotPath, fullPage: true });
    if (report.menuProbe?.opened) {
      await session.page.screenshot({ path: menuScreenshotPath, fullPage: false }).catch(() => undefined);
    }
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

    ctx.logEvent("probe-selectors", "info", "probe.complete", "Selector probe completed", {
      reportPath,
      screenshotPath,
      menuScreenshotPath,
      currentUrl: report.currentUrl,
      selectorCounts: report.selectorCounts,
      menuProbe: report.menuProbe
    });

    ctx.saveCheckpoint("probe-selectors", report as unknown as Record<string, unknown>);
    ctx.db.upsertRunState("probe-selectors", "complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.logEvent("probe-selectors", "error", "probe.failed", "Selector probe failed", { error: message });
    ctx.db.upsertRunState("probe-selectors", "failed");
    throw error;
  } finally {
    await session.close();
  }
}
