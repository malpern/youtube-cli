import { describe, expect, it } from "vitest";

import { buildAutomationBrowserLaunchPlan, deriveMacAppNameFromExecutablePath, parseRemoteDebuggingPort } from "./automationBrowser.js";
import type { RunConfig } from "../models/types.js";

const baseConfig: RunConfig = {
  profileDir: undefined,
  storageStatePath: undefined,
  expectedAccount: undefined,
  browserChannel: undefined,
  browserExecutablePath: undefined,
  browserCdpUrl: undefined,
  browserWindowWidth: undefined,
  browserWindowHeight: undefined,
  browserWindowPositionX: undefined,
  browserWindowPositionY: undefined,
  browserViewportWidth: undefined,
  browserViewportHeight: undefined,
  headless: false,
  artifactsDirName: "artifacts",
  stopOnAccountMismatch: true,
  slowMoMs: 0,
  youtubeBaseUrl: "https://www.youtube.com"
};

describe("automationBrowser", () => {
  it("derives a macOS app name from a browser executable path", () => {
    expect(
      deriveMacAppNameFromExecutablePath(
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
      )
    ).toBe("Google Chrome Canary");
  });

  it("falls back to the default remote debugging port", () => {
    expect(parseRemoteDebuggingPort(undefined)).toBe(9222);
    expect(parseRemoteDebuggingPort("not-a-url")).toBe(9222);
  });

  it("builds a direct executable launch plan when browserExecutablePath is configured", () => {
    const plan = buildAutomationBrowserLaunchPlan({
      rootDir: "/repo",
      config: {
        ...baseConfig,
        browserExecutablePath: "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        browserCdpUrl: "http://127.0.0.1:9333",
        profileDir: "/profiles/youtube-cli"
      }
    });

    expect(plan.mode).toBe("direct-exec");
    expect(plan.command).toBe("/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary");
    expect(plan.args).toEqual([
      "--remote-debugging-port=9333",
      "--user-data-dir=/profiles/youtube-cli",
      "--window-size=1280,900",
      "--window-position=1600,40",
      "--new-window",
      "https://www.youtube.com"
    ]);
    expect(plan.appName).toBe("Google Chrome Canary");
  });

  it("builds an open-app launch plan when only an app name is available", () => {
    const plan = buildAutomationBrowserLaunchPlan({
      rootDir: "/repo",
      config: baseConfig,
      overrides: {
        appName: "Google Chrome Canary",
        profileDir: ".local/custom-profile",
        url: "https://www.youtube.com/playlist?list=WL",
        browserWindowWidth: 1440,
        browserWindowHeight: 960,
        browserWindowPositionX: 1200,
        browserWindowPositionY: 24
      }
    });

    expect(plan.mode).toBe("open-app");
    expect(plan.command).toBe("open");
    expect(plan.args).toEqual([
      "-na",
      "Google Chrome Canary",
      "--args",
      "--remote-debugging-port=9222",
      "--user-data-dir=/repo/.local/custom-profile",
      "--window-size=1440,960",
      "--window-position=1200,24",
      "--new-window",
      "https://www.youtube.com/playlist?list=WL"
    ]);
  });
});
