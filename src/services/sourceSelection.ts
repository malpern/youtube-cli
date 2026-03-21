import type { InventoryItem } from "../models/types.js";

export function selectSourceItems(items: InventoryItem[], args: { startIndex?: number; maxItems?: number }): InventoryItem[] {
  const startIndex = args.startIndex ?? 1;
  const filtered = items.filter((item) => item.sourceIndex >= startIndex);

  if (typeof args.maxItems === "number") {
    return filtered.slice(0, args.maxItems);
  }

  return filtered;
}
