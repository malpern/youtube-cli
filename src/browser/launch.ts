import fs from "node:fs";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { RunConfig } from "../models/types.js";

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
    const page = await context.newPage();

    return {
      browser,
      context,
      page,
      close: async () => {
        await page.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      }
    };
  }

  const userDataDir = config.profileDir;
  const storageStatePath = config.storageStatePath;
  const launchOptions = {
    ...(config.browserChannel ? { channel: config.browserChannel } : {}),
    ...(config.browserExecutablePath ? { executablePath: config.browserExecutablePath } : {}),
    headless: config.headless,
    slowMo: config.slowMoMs
  };

  if (userDataDir) {
    const context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    const page = context.pages()[0] ?? (await context.newPage());
    return {
      context,
      page,
      close: async () => context.close()
    };
  }

  const browser = await chromium.launch(launchOptions);

  const context = await browser.newContext(
    storageStatePath && fs.existsSync(storageStatePath)
      ? { storageState: storageStatePath }
      : undefined
  );
  const page = await context.newPage();

  return {
    context,
    page,
    close: async () => browser.close()
  };
}
