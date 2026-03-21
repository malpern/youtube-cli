import type { InventoryItem, SourceItemPolicy, VerificationMismatch } from "../models/types.js";

export interface SourceItemPolicyAssessment {
  policy: SourceItemPolicy;
  reason: string;
}

export function assessSourceItemPolicy(item: InventoryItem): SourceItemPolicyAssessment {
  if (item.unavailableKind === "private" || item.unavailableKind === "deleted" || item.unavailableKind === "unavailable") {
    return {
      policy: "expected-non-copyable",
      reason: item.unavailableKind
    };
  }

  if (!item.videoUrl || item.unavailableKind === "unknown") {
    return {
      policy: "ambiguous-unavailable",
      reason: item.unavailableKind === "unknown" ? "unknown-unavailable-state" : "missing-video-url"
    };
  }

  return {
    policy: "copyable",
    reason: "has-copyable-video-url"
  };
}

export function partitionSourceItems(items: InventoryItem[]): {
  copyableItems: InventoryItem[];
  expectedNonCopyableItems: InventoryItem[];
  ambiguousItems: InventoryItem[];
} {
  const copyableItems: InventoryItem[] = [];
  const expectedNonCopyableItems: InventoryItem[] = [];
  const ambiguousItems: InventoryItem[] = [];

  for (const item of items) {
    const assessment = assessSourceItemPolicy(item);
    if (assessment.policy === "copyable") {
      copyableItems.push(item);
    } else if (assessment.policy === "expected-non-copyable") {
      expectedNonCopyableItems.push(item);
    } else {
      ambiguousItems.push(item);
    }
  }

  return {
    copyableItems,
    expectedNonCopyableItems,
    ambiguousItems
  };
}

export function ambiguousSourceItemMismatches(items: InventoryItem[]): VerificationMismatch[] {
  return items.map((item) => ({
    sourceIndex: item.sourceIndex,
    field: "ambiguous-source-item",
    expected: item.videoId ?? item.title ?? item.unavailableKind,
    actual: null
  }));
}
