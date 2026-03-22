import path from "node:path";

export function resolveStorageStateExportPath(args: {
  rootDir: string;
  configuredStorageStatePath?: string | undefined;
  outputPath?: string | undefined;
}): string {
  if (args.outputPath) {
    return path.resolve(args.rootDir, args.outputPath);
  }

  if (args.configuredStorageStatePath) {
    return path.resolve(args.rootDir, args.configuredStorageStatePath);
  }

  return path.resolve(args.rootDir, ".local", "youtube-storage-state.json");
}
