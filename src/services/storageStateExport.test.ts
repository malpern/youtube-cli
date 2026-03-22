import { describe, expect, it } from "vitest";

import { resolveStorageStateExportPath } from "./storageStateExport.js";

describe("storageStateExport", () => {
  it("prefers an explicit output path", () => {
    expect(
      resolveStorageStateExportPath({
        rootDir: "/repo",
        configuredStorageStatePath: ".local/configured.json",
        outputPath: "tmp/exported.json"
      })
    ).toBe("/repo/tmp/exported.json");
  });

  it("falls back to the configured storage state path", () => {
    expect(
      resolveStorageStateExportPath({
        rootDir: "/repo",
        configuredStorageStatePath: ".local/configured.json"
      })
    ).toBe("/repo/.local/configured.json");
  });

  it("uses the default local storage state path when nothing is configured", () => {
    expect(
      resolveStorageStateExportPath({
        rootDir: "/repo"
      })
    ).toBe("/repo/.local/youtube-storage-state.json");
  });
});
