import fs from "node:fs";
import path from "node:path";

export interface VerificationReport {
  reportVersion: number;
  reportComplete: boolean;
  capturedAt?: string;
  sourceSnapshotRunId: string;
  sourceSnapshotPath: string;
  targetPlaylist: string;
  targetPlaylistId?: string;
  passed: boolean;
  targetPassed: boolean;
  driftPassed: boolean;
  ambiguousSourceCount: number;
  targetMismatches: Array<{
    sourceIndex: number;
    field: string;
    expected: string | null;
    actual: string | null;
  }>;
  targetDiscrepancySummary?: {
    missingOccurrenceKeys?: string[];
    extraOccurrenceKeys?: string[];
    orderMismatchCount?: number;
    orderMismatches?: Array<{
      sourceIndex: number;
      expectedOccurrenceKey: string;
      actualOccurrenceKey: string | null;
    }>;
  };
  productionDeleteAuthorization: {
    authorized: boolean;
    reasons: string[];
    verificationRunId: string;
    sourceSnapshotRunId: string | null;
    targetPlaylist: string;
    verificationMode: "full" | "subset";
    verifiedAt: string;
  };
}

export function readVerificationReport(reportPath: string): VerificationReport {
  const parsed = JSON.parse(fs.readFileSync(reportPath, "utf8")) as Partial<VerificationReport>;

  if (parsed.reportVersion !== 1) {
    throw new Error(`Verification report at ${reportPath} is unsupported or incomplete. Re-run verify with the current CLI.`);
  }

  if (parsed.reportComplete !== true) {
    throw new Error(`Verification report at ${reportPath} is incomplete. Re-run verify with the current CLI.`);
  }

  if (!parsed.productionDeleteAuthorization) {
    throw new Error(`Verification report at ${reportPath} is missing production delete authorization. Re-run verify with the current CLI.`);
  }

  return parsed as VerificationReport;
}

export function resolveVerificationReportPath(rootDir: string, currentRunId: string, verificationRunId?: string): string {
  const runsDir = path.join(rootDir, "runs");

  if (verificationRunId) {
    const explicitPath = path.join(runsDir, verificationRunId, "verification.json");
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`Verification report not found for run '${verificationRunId}' at ${explicitPath}`);
    }

    return explicitPath;
  }

  if (!fs.existsSync(runsDir)) {
    throw new Error("No runs directory exists yet. Run verification first.");
  }

  const candidates = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== currentRunId)
    .map((entry) => {
      const reportPath = path.join(runsDir, entry.name, "verification.json");
      if (!fs.existsSync(reportPath)) {
        return null;
      }

      const stat = fs.statSync(reportPath);
      return {
        runId: entry.name,
        reportPath,
        mtimeMs: stat.mtimeMs
      };
    })
    .filter((entry): entry is { runId: string; reportPath: string; mtimeMs: number } => entry !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  const latest = candidates[0];
  if (!latest) {
    throw new Error("No verification report was found. Run the verify command first.");
  }

  return latest.reportPath;
}
