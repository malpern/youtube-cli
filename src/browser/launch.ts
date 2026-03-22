import fs from "node:fs";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { RunConfig } from "../models/types.js";
import { resolveBrowserWindowSettings } from "../services/browserWindowSettings.js";

const AUTOMATION_WINDOW_NAME = "__youtube_watchlist_automation__";

export interface BrowserSession {
  browser?: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export async function launchBrowserSession(config: RunConfig): Promise<BrowserSession> {
  if (config.browserCdpUrl) {
    const browser = await chromium.connectOverCDP(config.browserCdpUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await resolveAutomationPage(context);

    return {
      browser,
      context,
      page,
      close: async () => {
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

  return {
    context,
    page,
    close: async () => browser.close()
  };
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
    return await page.evaluate(() => window.name || null);
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
