import fs from "node:fs";

import type { Command } from "commander";

import { captureAccountSnapshot, accountMatches } from "../browser/accountCheck.js";
import { launchBrowserSession } from "../browser/launch.js";
import { createRunContext } from "../app/runContext.js";
import type { DoctorCheck } from "../models/types.js";

export async function runDoctor(command: Command): Promise<void> {
  const ctx = createRunContext(command, "doctor");
  const checks: DoctorCheck[] = [];

  checks.push({
    name: "node.version",
    ok: true,
    message: `Node ${process.version}`,
    details: { version: process.version }
  });

  checks.push({
    name: "run.dir",
    ok: fs.existsSync(ctx.artifacts.runDir),
    message: `Run directory: ${ctx.artifacts.runDir}`,
    details: { path: ctx.artifacts.runDir }
  });

  checks.push({
    name: "browser.config",
    ok: Boolean(ctx.config.browserCdpUrl || ctx.config.profileDir || ctx.config.storageStatePath),
    message: ctx.config.browserCdpUrl
      ? `Using CDP browser connection: ${ctx.config.browserCdpUrl}`
      : ctx.config.profileDir
      ? `Using persistent profile: ${ctx.config.profileDir}`
      : ctx.config.storageStatePath
        ? `Using storage state: ${ctx.config.storageStatePath}`
        : "No browser profile or storage state configured",
    details: {
      browserCdpUrl: ctx.config.browserCdpUrl,
      profileDir: ctx.config.profileDir,
      storageStatePath: ctx.config.storageStatePath,
      browserChannel: ctx.config.browserChannel,
      browserExecutablePath: ctx.config.browserExecutablePath
    }
  });

  try {
    const session = await launchBrowserSession(ctx.config);
    try {
      const snapshot = await captureAccountSnapshot(session.page, ctx.config.youtubeBaseUrl);
      const matches = accountMatches(ctx.config.expectedAccount, snapshot);
      checks.push({
        name: "youtube.auth",
        ok: snapshot.signedIn,
        message: snapshot.signedIn ? "Signed in to YouTube" : "Not signed in to YouTube",
        details: { ...snapshot }
      });
      checks.push({
        name: "youtube.account",
        ok: matches,
        message: ctx.config.expectedAccount
          ? matches
            ? `Account matched expected value: ${ctx.config.expectedAccount}`
            : `Account mismatch for expected value: ${ctx.config.expectedAccount}`
          : "No expectedAccount configured; account match skipped",
        details: {
          expectedAccount: ctx.config.expectedAccount,
          actualAccountLabel: snapshot.accountLabel
        }
      });
    } finally {
      await session.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      name: "browser.launch",
      ok: false,
      message,
      details: { error: message }
    });
  }

  const failedChecks = checks.filter((check) => !check.ok);
  for (const check of checks) {
    ctx.logEvent(
      "doctor",
      check.ok ? "info" : "warn",
      "doctor.check",
      `${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.message}`,
      check.details
    );
  }

  ctx.saveCheckpoint("doctor", { checks });
  ctx.db.upsertRunState("doctor", failedChecks.length > 0 ? "failed" : "complete");

  if (failedChecks.length > 0 && ctx.config.stopOnAccountMismatch) {
    process.exitCode = 1;
  }
}
