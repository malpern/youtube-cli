import fs from "node:fs";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { RunConfig } from "../models/types.js";
import { resolveBrowserWindowSettings } from "../services/browserWindowSettings.js";

const AUTOMATION_WINDOW_NAME = "__youtube_watchlist_automation__";
const CDP_HEALTH_CHECK_TIMEOUT_MS = 3_000;
const CDP_CONNECT_TIMEOUT_MS = 15_000;

export class StaleBrowserError extends Error {
  readonly cdpUrl: string;

  constructor(cdpUrl: string) {
    super(
      `Chrome is running but unresponsive to CDP commands. ` +
      `The browser at ${cdpUrl} may need to be restarted.`
    );
    this.name = "StaleBrowserError";
    this.cdpUrl = cdpUrl;
  }
}

export class BrowserNotRunningError extends Error {
  readonly cdpUrl: string;

  constructor(cdpUrl: string) {
    super(`No browser is listening on ${cdpUrl}. Launch Chrome with remote debugging first.`);
    this.name = "BrowserNotRunningError";
    this.cdpUrl = cdpUrl;
  }
}

export interface CdpHealthCheckResult {
  reachable: boolean;
  browser?: string | undefined;
}

export async function checkCdpHealth(cdpUrl: string): Promise<CdpHealthCheckResult> {
  const versionUrl = cdpUrl.replace(/\/$/, "") + "/json/version";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CDP_HEALTH_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(versionUrl, { signal: controller.signal });
    if (!response.ok) {
      return { reachable: false };
    }
    const data = (await response.json()) as { Browser?: string };
    return { reachable: true, browser: data.Browser };
  } catch {
    return { reachable: false };
  } finally {
    clearTimeout(timeout);
  }
}

export interface BrowserSession {
  browser?: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export async function launchBrowserSession(config: RunConfig): Promise<BrowserSession> {
  if (config.browserCdpUrl) {
    const health = await checkCdpHealth(config.browserCdpUrl);
    if (!health.reachable) {
      throw new BrowserNotRunningError(config.browserCdpUrl);
    }

    let browser: Browser;
    try {
      browser = await chromium.connectOverCDP(config.browserCdpUrl, {
        timeout: CDP_CONNECT_TIMEOUT_MS
      });
    } catch {
      throw new StaleBrowserError(config.browserCdpUrl);
    }

    const context = browser.contexts()[0] ?? (await browser.newContext());
    // Prefer reusing an existing page over creating a new one.
    // In CDP mode, context.newPage() can hang on some Chrome versions.
    const page = context.pages()[0] ?? (await context.newPage());

    return {
      browser,
      context,
      page,
      close: async () => {
        // In CDP mode, don't close the page — it's the user's browser tab.
        // Just disconnect the CDP connection.
        await browser.close().catch(() => undefined);
      }
    };
  }

  const userDataDir = config.profileDir;
  const storageStatePath = config.storageStatePath;
  const windowSettings = resolveBrowserWindowSettings(config);
  const launchOptions = {
    ...(config.browserChannel ? { channel: config.browserChannel } : {}),
    ...(config.browserExecutablePath ? { executablePath: config.browserExecutablePath } : {}),
    ...(windowSettings.nativeWindowArgs.length > 0 ? { args: windowSettings.nativeWindowArgs } : {}),
    headless: config.headless,
    slowMo: config.slowMoMs
  };

  if (userDataDir) {
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      ...(windowSettings.viewport ? { viewport: windowSettings.viewport } : {})
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await suppressVideoAutoplay(page);
    return {
      context,
      page,
      close: async () => context.close()
    };
  }

  const browser = await chromium.launch(launchOptions);

  const context = await browser.newContext(
    {
      ...(storageStatePath && fs.existsSync(storageStatePath)
        ? { storageState: storageStatePath }
        : {}),
      ...(windowSettings.viewport ? { viewport: windowSettings.viewport } : {})
    }
  );
  const page = await context.newPage();
  await suppressVideoAutoplay(page);

  return {
    context,
    page,
    close: async () => browser.close()
  };
}

async function suppressVideoAutoplay(page: Page): Promise<void> {
  // Inject a script that runs on every navigation to pause and mute videos
  // as soon as they appear. This prevents autoplay noise and reduces resource usage.
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      for (const video of document.querySelectorAll("video")) {
        if (!video.paused) {
          video.pause();
        }
        video.muted = true;
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Also override play() to prevent programmatic autoplay
    const originalPlay = HTMLVideoElement.prototype.play;
    HTMLVideoElement.prototype.play = function () {
      this.muted = true;
      this.pause();
      return Promise.resolve();
    };
  });
}

async function resolveAutomationPage(context: BrowserContext): Promise<Page> {
  const existingPages = context.pages();

  for (const page of existingPages) {
    const windowName = await readWindowName(page);
    if (windowName === AUTOMATION_WINDOW_NAME) {
      return page;
    }
  }

  const page = await context.newPage();
  await markAutomationPage(page);
  return page;
}

async function readWindowName(page: Page): Promise<string | null> {
  try {
    return await Promise.race([
      page.evaluate(() => window.name || null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000))
    ]);
  } catch {
    return null;
  }
}

async function markAutomationPage(page: Page): Promise<void> {
  await page
    .evaluate((windowName) => {
      window.name = windowName;
    }, AUTOMATION_WINDOW_NAME)
    .catch(() => undefined);
}
