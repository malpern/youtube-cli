import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { InventoryItem } from "../models/types.js";
import {
  ambiguousSourceItemMismatches,
  assessSourceItemPolicy,
  assertUsableSourceSnapshot,
  computeInventoryFingerprint,
  partitionSourceItems,
  readSourceSnapshot,
  resolveSourceSnapshotPath,
  selectSourceItems
} from "./sourceSnapshot.js";

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-watchlist-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeInventory(rootDir: string, runId: string, items: InventoryItem[]): string {
  const runDir = path.join(rootDir, "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const inventoryPath = path.join(runDir, "inventory.json");
  fs.writeFileSync(
    inventoryPath,
    `${JSON.stringify(
      {
        currentUrl: "https://www.youtube.com/playlist?list=WL",
        capturedAt: "2026-03-21T00:00:00.000Z",
        metadataVersion: 1,
        total: items.length,
        scrollPasses: 1,
        requestedMaxItems: null,
        bounded: false,
        items
      },
      null,
      2
    )}\n`
  );
  return inventoryPath;
}

function makeItem(sourceIndex: number, overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    sourceIndex,
    title: `Video ${sourceIndex}`,
    videoUrl: `https://www.youtube.com/watch?v=video-${sourceIndex}`,
    videoId: `video-${sourceIndex}`,
    channelName: "Channel",
    metadataText: null,
    unavailableKind: "none",
    ...overrides
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("computeInventoryFingerprint", () => {
  it("is stable for the same ordered items", () => {
    const items = [makeItem(1), makeItem(2), makeItem(3)];

    const left = computeInventoryFingerprint(items);
    const right = computeInventoryFingerprint(items);

    expect(left).toEqual(right);
    expect(left.total).toBe(3);
    expect(left.headIdentifiers).toEqual(["video-1", "video-2", "video-3"]);
  });

  it("changes when item order changes", () => {
    const ordered = computeInventoryFingerprint([makeItem(1), makeItem(2)]);
    const reordered = computeInventoryFingerprint([makeItem(2), makeItem(1)]);

    expect(ordered.orderedHash).not.toBe(reordered.orderedHash);
  });

  it("falls back to unavailable markers when no stable id exists", () => {
    const fingerprint = computeInventoryFingerprint([
      makeItem(1, {
        title: null,
        videoUrl: null,
        videoId: null,
        unavailableKind: "deleted"
      })
    ]);

    expect(fingerprint.headIdentifiers).toEqual(["unavailable:deleted:1"]);
  });
});

describe("readSourceSnapshot", () => {
  it("recomputes a fingerprint when the snapshot file lacks one", () => {
    const rootDir = makeTempRoot();
    const inventoryPath = writeInventory(rootDir, "run-a", [makeItem(1), makeItem(2)]);

    const snapshot = readSourceSnapshot(inventoryPath);

    expect(snapshot.runId).toBe("run-a");
    expect(snapshot.metadataVersion).toBe(1);
    expect(snapshot.metadataComplete).toBe(true);
    expect(snapshot.total).toBe(2);
    expect(snapshot.requestedMaxItems).toBeNull();
    expect(snapshot.bounded).toBe(false);
    expect(snapshot.fingerprint.orderedHash).toBe(computeInventoryFingerprint(snapshot.items).orderedHash);
  });

  it("marks legacy snapshots without metadata as incomplete", () => {
    const rootDir = makeTempRoot();
    const runDir = path.join(rootDir, "runs", "legacy-run");
    fs.mkdirSync(runDir, { recursive: true });
    const inventoryPath = path.join(runDir, "inventory.json");
    fs.writeFileSync(
      inventoryPath,
      `${JSON.stringify(
        {
          currentUrl: "https://www.youtube.com/playlist?list=WL",
          capturedAt: "2026-03-21T00:00:00.000Z",
          total: 1,
          scrollPasses: 1,
          items: [makeItem(1)]
        },
        null,
        2
      )}\n`
    );

    const snapshot = readSourceSnapshot(inventoryPath);

    expect(snapshot.metadataVersion).toBeNull();
    expect(snapshot.metadataComplete).toBe(false);
  });
});

describe("assertUsableSourceSnapshot", () => {
  it("accepts a non-empty snapshot and selection", () => {
    const snapshot = {
      runId: "run-a",
      currentUrl: "",
      capturedAt: "",
      metadataVersion: 1,
      metadataComplete: true,
      total: 1,
      scrollPasses: 1,
      requestedMaxItems: null,
      bounded: false,
      fingerprint: computeInventoryFingerprint([makeItem(1)]),
      items: [makeItem(1)]
    };

    expect(() => assertUsableSourceSnapshot(snapshot, 1)).not.toThrow();
  });

  it("throws for an empty snapshot", () => {
    const snapshot = {
      runId: "run-empty",
      currentUrl: "",
      capturedAt: "",
      metadataVersion: 1,
      metadataComplete: true,
      total: 0,
      scrollPasses: 0,
      requestedMaxItems: null,
      bounded: false,
      fingerprint: computeInventoryFingerprint([]),
      items: []
    };

    expect(() => assertUsableSourceSnapshot(snapshot, 0)).toThrow(/has no items/);
  });
});

describe("resolveSourceSnapshotPath", () => {
  it("returns an explicit source run path when present", () => {
    const rootDir = makeTempRoot();
    const inventoryPath = writeInventory(rootDir, "run-explicit", [makeItem(1)]);

    const resolved = resolveSourceSnapshotPath(rootDir, "current-run", "run-explicit");

    expect(resolved).toBe(inventoryPath);
  });

  it("returns the latest inventory snapshot when no explicit run id is provided", () => {
    const rootDir = makeTempRoot();
    const older = writeInventory(rootDir, "run-old", [makeItem(1)]);
    const newer = writeInventory(rootDir, "run-new", [makeItem(1), makeItem(2)]);
    fs.utimesSync(older, new Date("2026-03-20T00:00:00.000Z"), new Date("2026-03-20T00:00:00.000Z"));
    fs.utimesSync(newer, new Date("2026-03-21T00:00:00.000Z"), new Date("2026-03-21T00:00:00.000Z"));

    const resolved = resolveSourceSnapshotPath(rootDir, "current-run");

    expect(resolved).toBe(newer);
  });

  it("ignores the current run when choosing the latest fallback snapshot", () => {
    const rootDir = makeTempRoot();
    const older = writeInventory(rootDir, "run-old", [makeItem(1)]);
    const current = writeInventory(rootDir, "run-current", [makeItem(1), makeItem(2)]);
    fs.utimesSync(older, new Date("2026-03-21T00:00:00.000Z"), new Date("2026-03-21T00:00:00.000Z"));
    fs.utimesSync(current, new Date("2026-03-22T00:00:00.000Z"), new Date("2026-03-22T00:00:00.000Z"));

    const resolved = resolveSourceSnapshotPath(rootDir, "run-current");

    expect(resolved).toBe(older);
  });

  it("throws when the explicit source run does not exist", () => {
    const rootDir = makeTempRoot();

    expect(() => resolveSourceSnapshotPath(rootDir, "current-run", "missing-run")).toThrow(/Source snapshot not found/);
  });
});

describe("selectSourceItems", () => {
  it("returns all items from the start index onward", () => {
    expect(selectSourceItems([makeItem(1), makeItem(2), makeItem(3)], { startIndex: 2 })).toEqual([makeItem(2), makeItem(3)]);
  });

  it("applies max-items after start-index filtering", () => {
    expect(selectSourceItems([makeItem(1), makeItem(2), makeItem(3), makeItem(4)], { startIndex: 2, maxItems: 2 })).toEqual([
      makeItem(2),
      makeItem(3)
    ]);
  });

  it("defaults to the full item list when no bounds are provided", () => {
    expect(selectSourceItems([makeItem(1), makeItem(2)], {})).toEqual([makeItem(1), makeItem(2)]);
  });
});

describe("assessSourceItemPolicy", () => {
  it("marks normal rows as copyable", () => {
    expect(assessSourceItemPolicy(makeItem(1))).toEqual({
      policy: "copyable",
      reason: "has-copyable-video-url"
    });
  });

  it("marks private/deleted/unavailable rows as expected non-copyable", () => {
    expect(assessSourceItemPolicy(makeItem(1, { unavailableKind: "private", videoUrl: null, videoId: null }))).toEqual({
      policy: "expected-non-copyable",
      reason: "private"
    });

    expect(assessSourceItemPolicy(makeItem(2, { unavailableKind: "deleted", videoUrl: null, videoId: null }))).toEqual({
      policy: "expected-non-copyable",
      reason: "deleted"
    });
  });

  it("marks unknown or missing-url rows as ambiguous", () => {
    expect(assessSourceItemPolicy(makeItem(1, { unavailableKind: "unknown", videoUrl: null, videoId: null }))).toEqual({
      policy: "ambiguous-unavailable",
      reason: "unknown-unavailable-state"
    });

    expect(assessSourceItemPolicy(makeItem(2, { unavailableKind: "none", videoUrl: null }))).toEqual({
      policy: "ambiguous-unavailable",
      reason: "missing-video-url"
    });
  });
});

describe("partitionSourceItems", () => {
  it("splits source items by policy", () => {
    const partitioned = partitionSourceItems([
      makeItem(1),
      makeItem(2, { unavailableKind: "private", videoUrl: null, videoId: null }),
      makeItem(3, { unavailableKind: "unknown", videoUrl: null, videoId: null })
    ]);

    expect(partitioned.copyableItems.map((item) => item.sourceIndex)).toEqual([1]);
    expect(partitioned.expectedNonCopyableItems.map((item) => item.sourceIndex)).toEqual([2]);
    expect(partitioned.ambiguousItems.map((item) => item.sourceIndex)).toEqual([3]);
  });
});

describe("ambiguousSourceItemMismatches", () => {
  it("turns ambiguous items into verification mismatches", () => {
    expect(
      ambiguousSourceItemMismatches([
        makeItem(7, { title: null, videoId: null, videoUrl: null, unavailableKind: "unknown" })
      ])
    ).toEqual([
      {
        sourceIndex: 7,
        field: "ambiguous-source-item",
        expected: "unknown",
        actual: null
      }
    ]);
  });
});
