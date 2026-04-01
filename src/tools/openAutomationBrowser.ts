#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { Command } from "commander";

import { loadConfig } from "../config/loadConfig.js";
import { buildAutomationBrowserLaunchPlan } from "../services/automationBrowser.js";

const program = new Command();

program
  .name("open-automation-browser")
  .description("Open the dedicated macOS browser used for YouTube automation with CDP and predictable window bounds.")
  .option("--config <path>", "Path to JSON config file")
  .option("--app-name <name>", "macOS app name to open when no browserExecutablePath is configured")
  .option("--browser-executable-path <path>", "Browser executable path override")
  .option("--browser-cdp-url <url>", "Remote debugging URL to derive the launch port from")
  .option("--profile-dir <path>", "Dedicated browser profile directory")
  .option("--url <url>", "Initial URL to open", "https://www.youtube.com")
  .option("--browser-window-width <px>", "Native browser window width", "1280")
  .option("--browser-window-height <px>", "Native browser window height", "900")
  .option("--browser-window-position-x <px>", "Native browser window X position", "1600")
  .option("--browser-window-position-y <px>", "Native browser window Y position", "40")
  .option("--dry-run", "Print the launch command without opening the browser");

program.parse(process.argv);

const options = program.opts<{
  config?: string;
  appName?: string;
  browserExecutablePath?: string;
  browserCdpUrl?: string;
  profileDir?: string;
  url?: string;
  browserWindowWidth?: string;
  browserWindowHeight?: string;
  browserWindowPositionX?: string;
  browserWindowPositionY?: string;
  dryRun?: boolean;
}>();

const rootDir = process.cwd();
const configPath = resolveConfigPath(rootDir, options.config);
const config = configPath ? loadConfig(configPath) : loadConfig();
const plan = buildAutomationBrowserLaunchPlan({
  rootDir,
  config,
  overrides: {
    ...(options.appName ? { appName: options.appName } : {}),
    ...(options.browserExecutablePath ? { browserExecutablePath: options.browserExecutablePath } : {}),
    ...(options.browserCdpUrl ? { browserCdpUrl: options.browserCdpUrl } : {}),
    ...(options.profileDir ? { profileDir: options.profileDir } : {}),
    ...(options.url ? { url: options.url } : {}),
    ...(options.browserWindowWidth ? { browserWindowWidth: Number(options.browserWindowWidth) } : {}),
    ...(options.browserWindowHeight ? { browserWindowHeight: Number(options.browserWindowHeight) } : {}),
    ...(options.browserWindowPositionX ? { browserWindowPositionX: Number(options.browserWindowPositionX) } : {}),
    ...(options.browserWindowPositionY ? { browserWindowPositionY: Number(options.browserWindowPositionY) } : {})
  }
});

process.stdout.write(`${plan.summary}\n`);
process.stdout.write(`Command: ${renderCommand(plan.command, plan.args)}\n`);

if (options.dryRun) {
  process.stdout.write("Dry run only; browser not launched.\n");
  process.exit(0);
}

if (process.platform !== "darwin") {
  process.stderr.write("open-automation-browser currently supports macOS only.\n");
  process.exit(1);
}

fs.mkdirSync(plan.profileDir, { recursive: true });
const child = spawn(plan.command, plan.args, {
  cwd: rootDir,
  detached: true,
  stdio: "ignore"
});

child.unref();
process.stdout.write(`Launched ${plan.appName}. Attach the CLI with --browser-cdp-url http://127.0.0.1:${plan.remoteDebuggingPort}\n`);

function resolveConfigPath(rootDir: string, configuredPath: string | undefined): string | undefined {
  if (configuredPath) {
    return path.resolve(rootDir, configuredPath);
  }

  const defaultPath = path.join(rootDir, "config.local.json");
  return fs.existsSync(defaultPath) ? defaultPath : undefined;
}

function renderCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((value) => (/[^\w./:=+-]/.test(value) ? JSON.stringify(value) : value))
    .join(" ");
}
