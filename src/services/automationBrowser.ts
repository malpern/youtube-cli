import path from "node:path";

import type { RunConfig } from "../models/types.js";

export interface AutomationBrowserOverrides {
  appName?: string | undefined;
  browserExecutablePath?: string | undefined;
  browserCdpUrl?: string | undefined;
  profileDir?: string | undefined;
  url?: string | undefined;
  browserWindowWidth?: number | undefined;
  browserWindowHeight?: number | undefined;
  browserWindowPositionX?: number | undefined;
  browserWindowPositionY?: number | undefined;
}

export interface AutomationBrowserLaunchPlan {
  mode: "open-app" | "direct-exec";
  command: string;
  args: string[];
  appName: string;
  browserExecutablePath: string | undefined;
  profileDir: string;
  url: string;
  remoteDebuggingPort: number;
  summary: string;
}

const DEFAULT_CHROME_APP_NAME = "Google Chrome";
const DEFAULT_PROFILE_DIR = [".local", "chrome-youtube-profile"];
const DEFAULT_URL = "https://www.youtube.com";
const DEFAULT_REMOTE_DEBUGGING_PORT = 9222;
const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 900;
const DEFAULT_WINDOW_POSITION_X = 1600;
const DEFAULT_WINDOW_POSITION_Y = 40;

export function buildAutomationBrowserLaunchPlan(args: {
  rootDir: string;
  config: RunConfig;
  overrides?: AutomationBrowserOverrides;
}): AutomationBrowserLaunchPlan {
  const overrides = args.overrides ?? {};
  const browserExecutablePath = overrides.browserExecutablePath ?? args.config.browserExecutablePath;
  const appName =
    overrides.appName ??
    deriveMacAppNameFromExecutablePath(browserExecutablePath) ??
    DEFAULT_CHROME_APP_NAME;
  const profileDir = path.resolve(
    args.rootDir,
    overrides.profileDir ?? args.config.profileDir ?? path.join(...DEFAULT_PROFILE_DIR)
  );
  const url = overrides.url ?? args.config.youtubeBaseUrl ?? DEFAULT_URL;
  const remoteDebuggingPort = parseRemoteDebuggingPort(overrides.browserCdpUrl ?? args.config.browserCdpUrl);
  const browserWindowWidth = overrides.browserWindowWidth ?? args.config.browserWindowWidth ?? DEFAULT_WINDOW_WIDTH;
  const browserWindowHeight = overrides.browserWindowHeight ?? args.config.browserWindowHeight ?? DEFAULT_WINDOW_HEIGHT;
  const browserWindowPositionX =
    overrides.browserWindowPositionX ?? args.config.browserWindowPositionX ?? DEFAULT_WINDOW_POSITION_X;
  const browserWindowPositionY =
    overrides.browserWindowPositionY ?? args.config.browserWindowPositionY ?? DEFAULT_WINDOW_POSITION_Y;

  const browserArgs = [
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${browserWindowWidth},${browserWindowHeight}`,
    `--window-position=${browserWindowPositionX},${browserWindowPositionY}`,
    "--new-window",
    url
  ];

  if (browserExecutablePath) {
    return {
      mode: "direct-exec",
      command: browserExecutablePath,
      args: browserArgs,
      appName,
      browserExecutablePath,
      profileDir,
      url,
      remoteDebuggingPort,
      summary: `Launch ${appName} directly with profile ${profileDir} on CDP port ${remoteDebuggingPort}.`
    };
  }

  return {
    mode: "open-app",
    command: "open",
    args: ["-na", appName, "--args", ...browserArgs],
    appName,
    browserExecutablePath: undefined,
    profileDir,
    url,
    remoteDebuggingPort,
    summary: `Launch ${appName} via macOS open with profile ${profileDir} on CDP port ${remoteDebuggingPort}.`
  };
}

export function deriveMacAppNameFromExecutablePath(
  executablePath: string | undefined
): string | null {
  if (!executablePath) {
    return null;
  }

  const normalized = executablePath.replace(/\\/g, "/");
  const marker = ".app/Contents/MacOS/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const appPath = normalized.slice(0, markerIndex + 4);
  return path.basename(appPath, ".app");
}

export function parseRemoteDebuggingPort(browserCdpUrl: string | undefined): number {
  if (!browserCdpUrl) {
    return DEFAULT_REMOTE_DEBUGGING_PORT;
  }

  try {
    const parsed = new URL(browserCdpUrl);
    const explicitPort = parsed.port ? Number(parsed.port) : Number.NaN;
    return Number.isFinite(explicitPort) && explicitPort > 0 ? explicitPort : DEFAULT_REMOTE_DEBUGGING_PORT;
  } catch {
    return DEFAULT_REMOTE_DEBUGGING_PORT;
  }
}
