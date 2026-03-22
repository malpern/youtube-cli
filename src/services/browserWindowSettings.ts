export interface BrowserWindowSettingsInput {
  browserCdpUrl?: string | undefined;
  headless?: boolean | undefined;
  browserWindowWidth?: number | undefined;
  browserWindowHeight?: number | undefined;
  browserWindowPositionX?: number | undefined;
  browserWindowPositionY?: number | undefined;
  browserViewportWidth?: number | undefined;
  browserViewportHeight?: number | undefined;
}

export interface BrowserWindowSettingsSummary {
  nativeWindowControlSupported: boolean;
  nativeWindowArgs: string[];
  viewport: { width: number; height: number } | undefined;
  ignoredSettings: string[];
  notes: string[];
  summary: string;
}

export function resolveBrowserWindowSettings(
  input: BrowserWindowSettingsInput
): BrowserWindowSettingsSummary {
  const cdpMode = Boolean(input.browserCdpUrl);
  const headedMode = !input.headless;
  const nativeWindowControlSupported = !cdpMode && headedMode;
  const nativeWindowArgs: string[] = [];
  const ignoredSettings: string[] = [];
  const notes: string[] = [];

  const hasWindowSize = input.browserWindowWidth !== undefined || input.browserWindowHeight !== undefined;
  const hasWindowPosition = input.browserWindowPositionX !== undefined || input.browserWindowPositionY !== undefined;
  const hasViewport = input.browserViewportWidth !== undefined || input.browserViewportHeight !== undefined;

  if (nativeWindowControlSupported) {
    if (input.browserWindowWidth !== undefined && input.browserWindowHeight !== undefined) {
      nativeWindowArgs.push(`--window-size=${input.browserWindowWidth},${input.browserWindowHeight}`);
    } else if (hasWindowSize) {
      notes.push("Ignored browser window size override because both browserWindowWidth and browserWindowHeight are required.");
    }

    if (input.browserWindowPositionX !== undefined && input.browserWindowPositionY !== undefined) {
      nativeWindowArgs.push(`--window-position=${input.browserWindowPositionX},${input.browserWindowPositionY}`);
    } else if (hasWindowPosition) {
      notes.push("Ignored browser window position override because both browserWindowPositionX and browserWindowPositionY are required.");
    }
  } else {
    if (hasWindowSize) {
      ignoredSettings.push("browserWindowWidth", "browserWindowHeight");
    }

    if (hasWindowPosition) {
      ignoredSettings.push("browserWindowPositionX", "browserWindowPositionY");
    }
  }

  const viewport =
    !cdpMode && input.browserViewportWidth !== undefined && input.browserViewportHeight !== undefined
      ? {
          width: input.browserViewportWidth,
          height: input.browserViewportHeight
        }
      : undefined;

  if (!cdpMode && hasViewport && !viewport) {
    notes.push("Ignored browser viewport override because both browserViewportWidth and browserViewportHeight are required.");
  }

  if (cdpMode && hasViewport) {
    ignoredSettings.push("browserViewportWidth", "browserViewportHeight");
  }

  const summary = buildSummary({
    cdpMode,
    headedMode,
    nativeWindowArgs,
    viewport,
    ignoredSettings
  });

  return {
    nativeWindowControlSupported,
    nativeWindowArgs,
    viewport,
    ignoredSettings: Array.from(new Set(ignoredSettings)),
    notes,
    summary
  };
}

function buildSummary(args: {
  cdpMode: boolean;
  headedMode: boolean;
  nativeWindowArgs: string[];
  viewport: { width: number; height: number } | undefined;
  ignoredSettings: string[];
}): string {
  if (args.cdpMode) {
    return args.ignoredSettings.length > 0
      ? "CDP mode controls an existing browser window; window and viewport overrides are ignored."
      : "CDP mode controls an existing browser window; manage placement outside the CLI.";
  }

  if (!args.headedMode) {
    return args.viewport
      ? `Headless mode with viewport ${args.viewport.width}x${args.viewport.height}.`
      : "Headless mode; no visible automation window.";
  }

  if (args.nativeWindowArgs.length === 0 && !args.viewport) {
    return "Headed Playwright launch with default browser window placement.";
  }

  const parts: string[] = [];
  const sizeArg = args.nativeWindowArgs.find((value) => value.startsWith("--window-size="));
  const positionArg = args.nativeWindowArgs.find((value) => value.startsWith("--window-position="));

  if (sizeArg) {
    parts.push(`window ${sizeArg.replace("--window-size=", "")}`);
  }

  if (positionArg) {
    parts.push(`position ${positionArg.replace("--window-position=", "")}`);
  }

  if (args.viewport) {
    parts.push(`viewport ${args.viewport.width}x${args.viewport.height}`);
  }

  return `Headed Playwright launch with ${parts.join(", ")}.`;
}
