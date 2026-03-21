import type { InventoryItem, VerificationMismatch } from "../models/types.js";

export interface VerificationCountEvaluation {
  targetCountMatches: boolean;
  driftCountMatches: boolean;
}

export interface InventoryDiscrepancySummary {
  missingOccurrenceKeys: string[];
  extraOccurrenceKeys: string[];
  orderMismatchCount: number;
  orderMismatches: Array<{
    sourceIndex: number;
    expectedOccurrenceKey: string;
    actualOccurrenceKey: string | null;
  }>;
}

export function compareOrderedPrefix(sourceItems: InventoryItem[], targetItems: InventoryItem[]): VerificationMismatch[] {
  const mismatches: VerificationMismatch[] = [];

  for (let index = 0; index < sourceItems.length; index += 1) {
    const source = sourceItems[index];
    const target = targetItems[index];

    if (!source) {
      continue;
    }

    if (!target) {
      mismatches.push({
        sourceIndex: source.sourceIndex,
        field: "missing-target-item",
        expected: source.videoId ?? source.title,
        actual: null
      });
      continue;
    }

    if (source.videoId && target.videoId && source.videoId !== target.videoId) {
      mismatches.push({
        sourceIndex: source.sourceIndex,
        field: "videoId",
        expected: source.videoId,
        actual: target.videoId
      });
      continue;
    }

    if (!source.videoId && source.videoUrl && target.videoUrl && source.videoUrl !== target.videoUrl) {
      mismatches.push({
        sourceIndex: source.sourceIndex,
        field: "videoUrl",
        expected: source.videoUrl,
        actual: target.videoUrl
      });
      continue;
    }

    if (normalizeText(source.title) !== normalizeText(target.title)) {
      mismatches.push({
        sourceIndex: source.sourceIndex,
        field: "title",
        expected: source.title,
        actual: target.title
      });
    }
  }

  return mismatches;
}

export function evaluateVerificationCounts(args: {
  subsetLimit: number | undefined;
  sourceCount: number;
  targetCount: number;
  driftCount: number;
}): VerificationCountEvaluation {
  const { subsetLimit, sourceCount, targetCount, driftCount } = args;

  return {
    targetCountMatches: subsetLimit ? targetCount >= sourceCount : targetCount === sourceCount,
    driftCountMatches: subsetLimit ? driftCount >= sourceCount : driftCount === sourceCount
  };
}

export function analyzeInventoryDiscrepancies(sourceItems: InventoryItem[], targetItems: InventoryItem[]): InventoryDiscrepancySummary {
  const sourceOccurrenceKeys = buildOccurrenceKeys(sourceItems);
  const targetOccurrenceKeys = buildOccurrenceKeys(targetItems);
  const targetKeySet = new Set(targetOccurrenceKeys);
  const sourceKeySet = new Set(sourceOccurrenceKeys);

  const missingOccurrenceKeys = sourceOccurrenceKeys.filter((key) => !targetKeySet.has(key));
  const extraOccurrenceKeys = targetOccurrenceKeys.filter((key) => !sourceKeySet.has(key));
  const orderMismatches: InventoryDiscrepancySummary["orderMismatches"] = [];

  for (let index = 0; index < sourceOccurrenceKeys.length; index += 1) {
    const expectedOccurrenceKey = sourceOccurrenceKeys[index];
    const actualOccurrenceKey = targetOccurrenceKeys[index] ?? null;

    if (!expectedOccurrenceKey || expectedOccurrenceKey === actualOccurrenceKey) {
      continue;
    }

    orderMismatches.push({
      sourceIndex: sourceItems[index]?.sourceIndex ?? index + 1,
      expectedOccurrenceKey,
      actualOccurrenceKey
    });
  }

  return {
    missingOccurrenceKeys,
    extraOccurrenceKeys,
    orderMismatchCount: orderMismatches.length,
    orderMismatches
  };
}

export function discrepanciesAreClear(summary: InventoryDiscrepancySummary): boolean {
  return (
    summary.missingOccurrenceKeys.length === 0 &&
    summary.extraOccurrenceKeys.length === 0 &&
    summary.orderMismatchCount === 0
  );
}

function normalizeText(value: string | null): string | null {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? null;
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
