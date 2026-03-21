import type { InventoryItem } from "../models/types.js";
import type { VerificationReport } from "./verificationReport.js";

export interface RepairPlan {
  blockedReasons: string[];
  sourceIndicesToRetry: number[];
}

export function planRepair(report: VerificationReport, sourceItems: InventoryItem[]): RepairPlan {
  const blockedReasons: string[] = [];

  if (report.driftPassed === false) {
    blockedReasons.push("source-drift-verification-failed");
  }

  if (report.ambiguousSourceCount > 0) {
    blockedReasons.push("ambiguous-source-items-present");
  }

  const retrySourceIndices = new Set<number>();

  for (const mismatch of report.targetMismatches ?? []) {
    if (mismatch.field === "ambiguous-source-item") {
      continue;
    }

    retrySourceIndices.add(mismatch.sourceIndex);
  }

  for (const mismatch of report.targetDiscrepancySummary?.orderMismatches ?? []) {
    retrySourceIndices.add(mismatch.sourceIndex);
  }

  for (const occurrenceKey of report.targetDiscrepancySummary?.missingOccurrenceKeys ?? []) {
    const sourceIndex = resolveSourceIndexForOccurrenceKey(sourceItems, occurrenceKey);
    if (sourceIndex !== null) {
      retrySourceIndices.add(sourceIndex);
    }
  }

  return {
    blockedReasons,
    sourceIndicesToRetry: [...retrySourceIndices].sort((left, right) => left - right)
  };
}

function resolveSourceIndexForOccurrenceKey(sourceItems: InventoryItem[], occurrenceKey: string): number | null {
  const occurrenceKeys = buildOccurrenceKeys(sourceItems);
  const index = occurrenceKeys.indexOf(occurrenceKey);
  if (index < 0) {
    return null;
  }

  return sourceItems[index]?.sourceIndex ?? null;
}

function buildOccurrenceKeys(items: InventoryItem[]): string[] {
  const seenCounts = new Map<string, number>();

  return items.map((item) => {
    const identifier = stableIdentifier(item);
    const occurrence = (seenCounts.get(identifier) ?? 0) + 1;
    seenCounts.set(identifier, occurrence);
    return `${identifier}#${occurrence}`;
  });
}

function stableIdentifier(item: InventoryItem): string {
  return item.videoId ?? item.videoUrl ?? normalizeText(item.title) ?? `unavailable:${item.unavailableKind}:${item.sourceIndex}`;
}

function normalizeText(value: string | null): string | null {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? null;
}
