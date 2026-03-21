import path from "node:path";

import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { captureAccountSnapshot } from "../browser/accountCheck.js";
import { launchBrowserSession } from "../browser/launch.js";

function parseTimeoutMinutes(value: string | undefined): number {
  if (!value) {
    return 10;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 10;
  }

  return parsed;
}

export async function runLogin(command: Command): Promise<void> {
  const ctx = createRunContext(command, "login");
  const timeoutMinutes = parseTimeoutMinutes(command.opts<{ timeoutMinutes?: string }>().timeoutMinutes);
  const deadline = Date.now() + timeoutMinutes * 60_000;
  const screenshotPath = path.join(ctx.artifacts.screenshotsDir, "login-final.png");

  if (ctx.config.headless) {
    ctx.logEvent("login", "warn", "login.headless", "Login command forces headed mode; ignoring --headless", {});
    ctx.config.headless = false;
  }

  const session = await launchBrowserSession(ctx.config);

  try {
    await session.page.goto(ctx.config.youtubeBaseUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);

    ctx.logEvent("login", "info", "login.waiting", "Browser opened for manual sign-in", {
      timeoutMinutes,
      youtubeBaseUrl: ctx.config.youtubeBaseUrl
    });

    let signedInSnapshot = await captureAccountSnapshot(session.page, ctx.config.youtubeBaseUrl, {
      navigate: false
    });

    while (!signedInSnapshot.signedIn && Date.now() < deadline) {
      await session.page.waitForTimeout(3_000);
      signedInSnapshot = await captureAccountSnapshot(session.page, ctx.config.youtubeBaseUrl, {
        navigate: false
      });
    }

    await session.page.screenshot({ path: screenshotPath, fullPage: true });

    ctx.saveCheckpoint("login", {
      timeoutMinutes,
      screenshotPath,
      snapshot: signedInSnapshot
    });

    if (!signedInSnapshot.signedIn) {
      ctx.logEvent("login", "warn", "login.timeout", "Login command timed out before detecting a signed-in session", {
        screenshotPath,
        snapshot: signedInSnapshot
      });
      ctx.db.upsertRunState("login", "failed");
      process.exitCode = 1;
      return;
    }

    ctx.logEvent("login", "info", "login.success", "Detected signed-in YouTube session", {
      screenshotPath,
      snapshot: signedInSnapshot
    });
    ctx.db.upsertRunState("login", "complete");
  } finally {
    await session.close();
  }
}
