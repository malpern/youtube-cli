import fs from "node:fs";
import path from "node:path";

export function writeRunSummary(runDir: string, summary: Record<string, unknown>): string {
  const summaryPath = path.join(runDir, "summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return summaryPath;
}
