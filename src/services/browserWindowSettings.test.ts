import { describe, expect, it } from "vitest";

import { resolveBrowserWindowSettings } from "./browserWindowSettings.js";

describe("browserWindowSettings", () => {
  it("builds native window args and viewport for headed Playwright launches", () => {
    const result = resolveBrowserWindowSettings({
      headless: false,
      browserWindowWidth: 1280,
      browserWindowHeight: 900,
      browserWindowPositionX: 1600,
      browserWindowPositionY: 40,
      browserViewportWidth: 1280,
      browserViewportHeight: 900
    });

    expect(result.nativeWindowControlSupported).toBe(true);
    expect(result.nativeWindowArgs).toEqual([
      "--window-size=1280,900",
      "--window-position=1600,40"
    ]);
    expect(result.viewport).toEqual({ width: 1280, height: 900 });
    expect(result.ignoredSettings).toEqual([]);
  });

  it("keeps viewport control in headless mode but skips native window args", () => {
    const result = resolveBrowserWindowSettings({
      headless: true,
      browserWindowWidth: 1280,
      browserWindowHeight: 900,
      browserViewportWidth: 1440,
      browserViewportHeight: 960
    });

    expect(result.nativeWindowControlSupported).toBe(false);
    expect(result.nativeWindowArgs).toEqual([]);
    expect(result.viewport).toEqual({ width: 1440, height: 960 });
    expect(result.ignoredSettings).toEqual(["browserWindowWidth", "browserWindowHeight"]);
  });

  it("ignores window and viewport overrides in CDP mode", () => {
    const result = resolveBrowserWindowSettings({
      browserCdpUrl: "http://127.0.0.1:9222",
      browserWindowWidth: 1280,
      browserWindowHeight: 900,
      browserWindowPositionX: 1600,
      browserWindowPositionY: 40,
      browserViewportWidth: 1280,
      browserViewportHeight: 900
    });

    expect(result.nativeWindowControlSupported).toBe(false);
    expect(result.nativeWindowArgs).toEqual([]);
    expect(result.viewport).toBeUndefined();
    expect(result.ignoredSettings).toEqual([
      "browserWindowWidth",
      "browserWindowHeight",
      "browserWindowPositionX",
      "browserWindowPositionY",
      "browserViewportWidth",
      "browserViewportHeight"
    ]);
  });

  it("ignores partial window and viewport pairs", () => {
    const result = resolveBrowserWindowSettings({
      headless: false,
      browserWindowWidth: 1280,
      browserViewportHeight: 900
    });

    expect(result.nativeWindowArgs).toEqual([]);
    expect(result.viewport).toBeUndefined();
    expect(result.notes).toEqual([
      "Ignored browser window size override because both browserWindowWidth and browserWindowHeight are required.",
      "Ignored browser viewport override because both browserViewportWidth and browserViewportHeight are required."
    ]);
  });
});
