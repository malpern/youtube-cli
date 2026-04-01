export interface GlobalOptions {
  config?: string;
  profileDir?: string;
  storageState?: string;
  expectedAccount?: string;
  browserChannel?: string;
  browserExecutablePath?: string;
  browserCdpUrl?: string;
  browserWindowWidth?: string;
  browserWindowHeight?: string;
  browserWindowPositionX?: string;
  browserWindowPositionY?: string;
  browserViewportWidth?: string;
  browserViewportHeight?: string;
  headless?: boolean;
  slowMoMs?: string;
}

export function buildGlobalArgs(options: GlobalOptions): string[] {
  const args: string[] = [];

  appendOptionalArg(args, "--config", options.config);
  appendOptionalArg(args, "--profile-dir", options.profileDir);
  appendOptionalArg(args, "--storage-state", options.storageState);
  appendOptionalArg(args, "--expected-account", options.expectedAccount);
  appendOptionalArg(args, "--browser-channel", options.browserChannel);
  appendOptionalArg(args, "--browser-executable-path", options.browserExecutablePath);
  appendOptionalArg(args, "--browser-cdp-url", options.browserCdpUrl);
  appendOptionalArg(args, "--browser-window-width", options.browserWindowWidth);
  appendOptionalArg(args, "--browser-window-height", options.browserWindowHeight);
  appendOptionalArg(args, "--browser-window-position-x", options.browserWindowPositionX);
  appendOptionalArg(args, "--browser-window-position-y", options.browserWindowPositionY);
  appendOptionalArg(args, "--browser-viewport-width", options.browserViewportWidth);
  appendOptionalArg(args, "--browser-viewport-height", options.browserViewportHeight);
  appendOptionalArg(args, "--slow-mo-ms", options.slowMoMs);

  if (options.headless) {
    args.push("--headless");
  }

  return args;
}

export function appendOptionalArg(args: string[], flag: string, value: string | undefined): void {
  if (value && value.trim().length > 0) {
    args.push(flag, value);
  }
}

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}
