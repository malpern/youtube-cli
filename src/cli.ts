#!/usr/bin/env node
import { Command } from "commander";

import { runLogin } from "./phases/login.js";
import { runDoctor } from "./phases/doctor.js";
import { runInventory } from "./phases/inventory.js";
import { runCopy } from "./phases/copy.js";
import { runSetup } from "./phases/setup.js";
import { runProbeSelectors } from "./phases/probeSelectors.js";
import { runRepair } from "./phases/repair.js";
import { runVerify } from "./phases/verify.js";
import { runCopyPerformance } from "./phases/copyPerformance.js";

const program = new Command();

program
  .name("youtube-watchlist")
  .description("Diagnostic-first CLI for migrating YouTube Watch Later into Old Watch.")
  .option("--config <path>", "Path to JSON config file")
  .option("--run-id <id>", "Run id to use for output directory names")
  .option("--profile-dir <path>", "Playwright persistent profile directory override")
  .option("--storage-state <path>", "Playwright storage state file override")
  .option("--expected-account <value>", "Expected YouTube account label fragment override")
  .option("--browser-channel <name>", "Playwright browser channel override, for example chrome")
  .option("--browser-executable-path <path>", "Browser executable path override")
  .option("--browser-cdp-url <url>", "Connect to an already running browser over CDP")
  .option("--headless", "Launch browser headless")
  .option("--slow-mo-ms <ms>", "Playwright slowMo override in milliseconds");

program
  .command("login")
  .description("Open the configured browser/profile and wait for a manual YouTube sign-in")
  .option("--timeout-minutes <minutes>", "How long to wait for manual sign-in detection", "10")
  .action(async function action() {
    await runLogin(this);
  });

program
  .command("doctor")
  .description("Validate local environment, browser session config, and YouTube auth state")
  .action(async function action() {
    await runDoctor(this);
  });

program
  .command("setup")
  .description("Ensure the target playlist exists by using the save-to-playlist UI on a Watch Later video")
  .option("--target-playlist <name>", "Playlist name to ensure exists", "Old Watch")
  .action(async function action() {
    await runSetup(this);
  });

program
  .command("probe-selectors")
  .description("Open Watch Later and report live selector counts for key UI surfaces")
  .action(async function action() {
    await runProbeSelectors(this);
  });

program
  .command("inventory")
  .description("Load Watch Later, scroll to completion, and write an ordered inventory to disk")
  .option("--max-items <count>", "Stop after collecting this many rows")
  .option("--max-no-growth-passes <count>", "Number of no-growth scroll passes before stopping", "3")
  .option("--settle-ms <ms>", "Wait time after each scroll pass", "1500")
  .action(async function action() {
    await runInventory(this);
  });

program
  .command("copy")
  .description("Copy source snapshot items into the target playlist using the watch-page save panel")
  .option("--target-playlist <name>", "Playlist name to copy into", "Old Watch")
  .option("--source-run-id <id>", "Run id containing the inventory snapshot to use as the source of truth")
  .option("--max-items <count>", "Stop after processing this many snapshot rows")
  .option("--milestone-every <count>", "Emit a copy progress summary every N processed items", "5")
  .option("--resume", "Resume from the checkpoint in the selected run directory")
  .action(async function action() {
    await runCopy(this);
  });

program
  .command("verify")
  .description("Compare the target playlist and live Watch Later against a saved source snapshot")
  .option("--target-playlist <name>", "Playlist name to verify", "Old Watch")
  .option("--source-run-id <id>", "Run id containing the inventory snapshot to use as the source of truth")
  .option("--max-items <count>", "Compare only the first N source snapshot rows")
  .option("--max-no-growth-passes <count>", "Number of no-growth scroll passes before stopping", "2")
  .option("--settle-ms <ms>", "Wait time after each scroll pass", "1200")
  .action(async function action() {
    await runVerify(this);
  });

program
  .command("repair")
  .description("Retry target-side verification failures from a saved verification report")
  .option("--target-playlist <name>", "Playlist name to repair into", "Old Watch")
  .option("--verification-run-id <id>", "Run id containing the verification report to repair from")
  .option("--max-items <count>", "Stop after repairing this many planned items")
  .option("--milestone-every <count>", "Emit a repair progress summary every N processed items", "5")
  .option("--resume", "Resume from the checkpoint in the selected run directory")
  .action(async function action() {
    await runRepair(this);
  });

program
  .command("copy-performance")
  .description("Analyze completed copy runs for throughput and latency variability")
  .requiredOption("--copy-run-id <ids...>", "Copy run ids to analyze")
  .option("--write-path <path>", "Optional JSON output path override")
  .action(async function action() {
    await runCopyPerformance(this);
  });

await program.parseAsync(process.argv);
