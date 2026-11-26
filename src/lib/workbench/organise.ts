// Phase 38 — Organise Pallets planner (pure functions; the page executes
// the plan through the transfer_cartons RPC).
//
// The invariant (industry rule for pallet merges): a merge MOVES stock,
// it never copies it — the container's total units are identical before
// and after any organise action. These helpers only READ the live entry
// list and describe piles/plans; the RPC does the moving.

import type { ExpectedItem, Pallet, PalletEntry } from '@/types/wms';

export interface PileEntry {
  id: string;
  cartons: number;
  goodQty: number;
  damagedQty: number;
  packSizeUsed: number;
}

/** One product's stock sitting on one pallet. */
export interface ProductPile {
  palletId: string;
  palletCode: string;
  palletStatus: string;
  boxes: number;
  units: number; // good units
  damagedUnits: number;
  entries: PileEntry[]; // oldest first — transfers consume FIFO
}

export interface ProductPiles {
  itemId: string;
  skuCode: string;
  productName: string;
  totalBoxes: number;
  totalUnits: number;
  piles: ProductPile[]; // sorted by pallet code
  /** Pallet holding the biggest pile — the natural merge target. */
  suggestedTargetPalletId: string;
}

export interface PalletProductRow {
  itemId: string;
  skuCode: string;
  productName: string;
  boxes: number;
  units: number;
  damagedUnits: number;
  entries: PileEntry[];
}

export interface PalletSummary {
  palletId: string;
  palletCode: string;
  palletStatus: string;
  boxes: number;
  units: number;
  damagedUnits: number;
  products: PalletProductRow[]; // sorted by product name
  isEmpty: boolean;
}

function liveEntries(entries: PalletEntry[]): PalletEntry[] {
  // An entry is live while it holds anything — a row with 0 cartons but
  // loose good or damaged units is real stock (loose-only / damage-only
  // rows) and must stay in the piles and the container totals.
  return entries.filter(
    (e) => !e.is_voided && (e.cartons_counted > 0 || e.good_qty > 0 || e.damaged_qty > 0)
  );
}

/** Group every product's live entries by pallet. Entries keep the order
 *  they are given (callers pass newest-first; piles store oldest-first,
 *  matching the workbench transfer behaviour). */
export function groupProductPiles(
  entries: PalletEntry[],
  items: ExpectedItem[],
  pallets: Pallet[]
): ProductPiles[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const palletById = new Map(pallets.map((p) => [p.id, p]));
  const byItem = new Map<string, Map<string, ProductPile>>();

  // Walk reversed so each pile's entries end up oldest-first (FIFO).
  for (const e of [...liveEntries(entries)].reverse()) {
    const item = itemById.get(e.item_id);
    const pallet = palletById.get(e.pallet_id);
    if (!item || !pallet) continue;
    let perPallet = byItem.get(e.item_id);
    if (!perPallet) {
      perPallet = new Map();
      byItem.set(e.item_id, perPallet);
    }
    let pile = perPallet.get(e.pallet_id);
    if (!pile) {
      pile = {
        palletId: pallet.id,
        palletCode: pallet.pallet_code,
        palletStatus: pallet.status,
        boxes: 0,
        units: 0,
        damagedUnits: 0,
        entries: [],
      };
      perPallet.set(e.pallet_id, pile);
    }
    pile.boxes += e.cartons_counted;
    pile.units += e.good_qty;
    pile.damagedUnits += e.damaged_qty;
    pile.entries.push({
      id: e.id,
      cartons: e.cartons_counted,
      goodQty: e.good_qty,
      damagedQty: e.damaged_qty,
      packSizeUsed: e.pack_size_used,
    });
  }

  const result: ProductPiles[] = [];
  byItem.forEach((perPallet, itemId) => {
    const item = itemById.get(itemId);
    if (!item) return;
    const piles = Array.from(perPallet.values()).sort((a, b) =>
      a.palletCode.localeCompare(b.palletCode)
    );
    const biggest = piles.reduce((best, p) =>
      p.units > best.units ||
      (p.units === best.units && p.palletCode < best.palletCode)
        ? p
        : best
    );
    result.push({
      itemId,
      skuCode: item.sku_code,
      productName: item.product_name,
      totalBoxes: piles.reduce((s, p) => s + p.boxes, 0),
      totalUnits: piles.reduce((s, p) => s + p.units, 0),
      piles,
      suggestedTargetPalletId: biggest.palletId,
    });
  });
  return result.sort((a, b) => a.productName.localeCompare(b.productName));
}

/** Products split across more than one pallet — the fix-list for the
 *  Organise screen's one-tap "bring together" action. */
export function splitProducts(
  entries: PalletEntry[],
  items: ExpectedItem[],
  pallets: Pallet[]
): ProductPiles[] {
  return groupProductPiles(entries, items, pallets).filter(
    (p) => p.piles.length > 1
  );
}

/** Per-pallet contents for the Organise screen's pallet cards. */
export function palletSummaries(
  entries: PalletEntry[],
  items: ExpectedItem[],
  pallets: Pallet[]
): PalletSummary[] {
  const grouped = groupProductPiles(entries, items, pallets);
  const rowsByPallet = new Map<string, PalletProductRow[]>();
  for (const product of grouped) {
    for (const pile of product.piles) {
      const rows = rowsByPallet.get(pile.palletId) || [];
      rows.push({
        itemId: product.itemId,
        skuCode: product.skuCode,
        productName: product.productName,
        boxes: pile.boxes,
        units: pile.units,
        damagedUnits: pile.damagedUnits,
        entries: pile.entries,
      });
      rowsByPallet.set(pile.palletId, rows);
    }
  }
  return [...pallets]
    .sort((a, b) => a.pallet_code.localeCompare(b.pallet_code))
    .map((pallet) => {
      const products = (rowsByPallet.get(pallet.id) || []).sort((a, b) =>
        a.productName.localeCompare(b.productName)
      );
      return {
        palletId: pallet.id,
        palletCode: pallet.pallet_code,
        palletStatus: pallet.status,
        boxes: products.reduce((s, r) => s + r.boxes, 0),
        units: products.reduce((s, r) => s + r.units, 0),
        damagedUnits: products.reduce((s, r) => s + r.damagedUnits, 0),
        products,
        isEmpty: products.length === 0,
      };
    });
}

/** Container-wide totals — the number that must never change across an
 *  organise action (moves, never copies). */
export function containerTotals(entries: PalletEntry[]): {
  boxes: number;
  units: number;
} {
  return liveEntries(entries).reduce(
    (acc, e) => ({
      boxes: acc.boxes + e.cartons_counted,
      units: acc.units + e.good_qty,
    }),
    { boxes: 0, units: 0 }
  );
}
