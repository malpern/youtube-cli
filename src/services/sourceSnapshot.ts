import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { InventoryFingerprint, InventoryItem, SourceItemPolicy, SourceSnapshot, VerificationMismatch } from "../models/types.js";

function identifierForItem(item: InventoryItem): string {
  return item.videoId ?? item.videoUrl ?? item.title ?? `unavailable:${item.unavailableKind}:${item.sourceIndex}`;
}

export function computeInventoryFingerprint(items: InventoryItem[]): InventoryFingerprint {
  const identifiers = items.map(identifierForItem);
  const orderedHash = crypto.createHash("sha256").update(identifiers.join("\n")).digest("hex");

  return {
    total: items.length,
    orderedHash,
    headIdentifiers: identifiers.slice(0, 5),
    tailIdentifiers: identifiers.slice(Math.max(identifiers.length - 5, 0))
  };
}

export function readSourceSnapshot(snapshotPath: string): SourceSnapshot {
  const parsed = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as Partial<SourceSnapshot> & {
    items?: InventoryItem[];
    total?: number;
    currentUrl?: string;
    capturedAt?: string;
    scrollPasses?: number;
  };

  const items = parsed.items ?? [];
  const runId = path.basename(path.dirname(snapshotPath));

  return {
    runId,
    currentUrl: parsed.currentUrl ?? "",
    capturedAt: parsed.capturedAt ?? "",
    metadataVersion: typeof parsed.metadataVersion === "number" ? parsed.metadataVersion : null,
    metadataComplete:
      typeof parsed.metadataVersion === "number" &&
      typeof parsed.bounded === "boolean" &&
      (typeof parsed.requestedMaxItems === "number" || parsed.requestedMaxItems === null),
    total: parsed.total ?? items.length,
    scrollPasses: parsed.scrollPasses ?? 0,
    requestedMaxItems: typeof parsed.requestedMaxItems === "number" ? parsed.requestedMaxItems : null,
    bounded: typeof parsed.bounded === "boolean" ? parsed.bounded : false,
    fingerprint: parsed.fingerprint ?? computeInventoryFingerprint(items),
    items
  };
}

export function assertUsableSourceSnapshot(snapshot: SourceSnapshot, selectedCount: number): void {
  if (snapshot.items.length === 0) {
    throw new Error(`Source snapshot '${snapshot.runId}' has no items`);
  }

  if (selectedCount <= 0) {
    throw new Error(`Source snapshot '${snapshot.runId}' produced an empty selection`);
  }

  if (snapshot.total <= 0) {
    throw new Error(`Source snapshot '${snapshot.runId}' has an invalid total count`);
  }
}

export function resolveSourceSnapshotPath(rootDir: string, currentRunId: string, sourceRunId?: string): string {
  const runsDir = path.join(rootDir, "runs");

  if (sourceRunId) {
    const explicitPath = path.join(runsDir, sourceRunId, "inventory.json");
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`Source snapshot not found for run '${sourceRunId}' at ${explicitPath}`);
    }

    return explicitPath;
  }

  if (!fs.existsSync(runsDir)) {
    throw new Error("No runs directory exists yet. Capture an inventory snapshot first.");
  }

  const candidates = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== currentRunId)
    .map((entry) => {
      const snapshotPath = path.join(runsDir, entry.name, "inventory.json");
      if (!fs.existsSync(snapshotPath)) {
        return null;
      }

      const stat = fs.statSync(snapshotPath);
      return {
        runId: entry.name,
        snapshotPath,
        mtimeMs: stat.mtimeMs
      };
    })
    .filter((entry): entry is { runId: string; snapshotPath: string; mtimeMs: number } => entry !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  const latest = candidates[0];
  if (!latest) {
    throw new Error("No inventory snapshot was found. Run the inventory command first.");
  }

  return latest.snapshotPath;
}

// --- Source Selection ---

export function selectSourceItems(items: InventoryItem[], args: { startIndex?: number; maxItems?: number }): InventoryItem[] {
  const startIndex = args.startIndex ?? 1;
  const filtered = items.filter((item) => item.sourceIndex >= startIndex);

  if (typeof args.maxItems === "number") {
    return filtered.slice(0, args.maxItems);
  }

  return filtered;
}

// --- Source Item Policy ---

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
