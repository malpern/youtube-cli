import fs from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { createRunContext } from "../app/runContext.js";
import { accountMatches, captureAccountSnapshot } from "../browser/accountCheck.js";
import { launchBrowserSession } from "../browser/launch.js";
import { ensureDir } from "../utils/filesystem.js";
import { resolveStorageStateExportPath } from "../services/storageStateExport.js";

interface ExportStorageStateOptions {
  output?: string;
  json?: boolean;
}

function writeJson(payload: object): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export async function runExportStorageState(command: Command): Promise<void> {
  const options = command.opts<ExportStorageStateOptions>();
  const json = Boolean(options.json);
  const ctx = createRunContext(command, "export-storage-state", json ? { consoleStream: process.stderr } : {});

  if (!ctx.config.browserCdpUrl) {
    const message = "export-storage-state requires --browser-cdp-url or browserCdpUrl in config so the trusted live browser session can be reused.";

    if (json) {
      writeJson({ ok: false, runId: ctx.runId, error: message });
      process.exitCode = 1;
      return;
    }

    throw new Error(message);
  }

  const outputPath = resolveStorageStateExportPath({
    rootDir: ctx.rootDir,
    configuredStorageStatePath: ctx.config.storageStatePath,
    outputPath: options.output
  });
  const screenshotPath = path.join(ctx.artifacts.screenshotsDir, "export-storage-state-auth-check.png");
  ensureDir(path.dirname(outputPath));

  const session = await launchBrowserSession(ctx.config);
  const page = await session.context.newPage();

  try {
    const snapshot = await captureAccountSnapshot(page, ctx.config.youtubeBaseUrl);

    if (!snapshot.signedIn) {
      throw new Error("Refusing to export storage state because the live browser session is not signed in to YouTube.");
    }

    if (!accountMatches(ctx.config.expectedAccount, snapshot)) {
      throw new Error(
        `Refusing to export storage state because the signed-in account did not match expectedAccount '${ctx.config.expectedAccount}'.`
      );
    }

    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
    await session.context.storageState({ path: outputPath });

    const stats = fs.statSync(outputPath);
    const payload = {
      ok: true,
      runId: ctx.runId,
      outputPath,
      bytes: stats.size,
      browserCdpUrl: ctx.config.browserCdpUrl,
      accountLabel: snapshot.accountLabel,
      screenshotPath
    };

    ctx.saveCheckpoint("export-storage-state", payload);
    ctx.logEvent("export-storage-state", "info", "storage-state.exported", "Exported storage state from live CDP browser", payload);
    ctx.db.upsertRunState("export-storage-state", "complete");

    if (json) {
      writeJson(payload);
      return;
    }

    console.log(`Exported storage state to ${outputPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.logEvent("export-storage-state", "error", "storage-state.export.failed", "Failed to export storage state", {
      error: message,
      outputPath,
      screenshotPath
    });
    ctx.db.upsertRunState("export-storage-state", "failed");

    if (json) {
      writeJson({
        ok: false,
        runId: ctx.runId,
        error: message,
        outputPath,
        screenshotPath
      });
      process.exitCode = 1;
      return;
    }

    throw error;
  } finally {
    await page.close().catch(() => undefined);
    await session.close();
  }
}
