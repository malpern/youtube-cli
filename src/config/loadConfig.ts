import fs from "node:fs";
import path from "node:path";

import { runConfigSchema } from "./schema.js";
import type { RunConfig } from "../models/types.js";

export function loadConfig(configPath?: string): RunConfig {
  if (!configPath) {
    return normalizeConfig(runConfigSchema.parse({}));
  }

  const resolvedPath = path.resolve(configPath);
  const fileContents = fs.readFileSync(resolvedPath, "utf8");
  const parsed = JSON.parse(fileContents) as unknown;

  return normalizeConfig(runConfigSchema.parse(parsed));
}

function normalizeConfig(parsed: ReturnType<typeof runConfigSchema.parse>): RunConfig {
  return {
    profileDir: parsed.profileDir,
    storageStatePath: parsed.storageStatePath,
    expectedAccount: parsed.expectedAccount,
    browserChannel: parsed.browserChannel,
    browserExecutablePath: parsed.browserExecutablePath,
    browserCdpUrl: parsed.browserCdpUrl,
    headless: parsed.headless,
    artifactsDirName: parsed.artifactsDirName,
    stopOnAccountMismatch: parsed.stopOnAccountMismatch,
    slowMoMs: parsed.slowMoMs,
    youtubeBaseUrl: parsed.youtubeBaseUrl
  };
}
