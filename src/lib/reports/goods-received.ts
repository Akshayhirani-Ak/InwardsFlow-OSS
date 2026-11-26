// InwardsFlow — Phase 23: Goods Received list aggregation.
//
// The Goods Received list is a handover sheet: it lists ONLY what was
// actually received (good units), nothing else. No ordered quantities, no
// shipped quantities, no variance story — the owed/short story lives on
// the PO balance, not on this sheet. A line with zero good units never
// appears. Quantities come from counted pallet entries, never from the
// supplier's documents.

import type { ExpectedItem, PalletEntry } from '@/types/wms';

export interface GoodsReceivedLine {
  itemId: string;
  productCode: string;
  supplierCode: string | null;
  productName: string;
  unit: string;
  received: number;
  cartons: number;
}

/**
 * Aggregate counted entries into received lines for one container's items.
 * Voided entries are ignored. Only lines with good qty > 0 are returned,
 * sorted by product code. Cartons counts the cartons on entries that
 * contributed good units (a wholly-damaged carton is not a received line).
 */
export function buildGoodsReceivedLines(
  items: ExpectedItem[],
  entries: PalletEntry[]
): GoodsReceivedLine[] {
  const byItem = new Map<string, { good: number; cartons: number }>();
  for (const e of entries) {
    if (e.is_voided) continue;
    const cur = byItem.get(e.item_id) || { good: 0, cartons: 0 };
    cur.good += e.good_qty || 0;
    if ((e.good_qty || 0) > 0) cur.cartons += e.cartons_counted || 0;
    byItem.set(e.item_id, cur);
  }

  const lines: GoodsReceivedLine[] = [];
  for (const item of items) {
    const agg = byItem.get(item.id);
    if (!agg || agg.good <= 0) continue;
    lines.push({
      itemId: item.id,
      productCode: item.sku_code,
      supplierCode: item.supplier_sku_code || null,
      productName: item.product_name,
      unit: item.uom || 'pcs',
      received: agg.good,
      cartons: agg.cartons,
    });
  }

  lines.sort((a, b) =>
    a.productCode === b.productCode
      ? a.productName.localeCompare(b.productName)
      : a.productCode.localeCompare(b.productCode)
  );
  return lines;
}

export interface GoodsReceivedTotals {
  lineCount: number;
  totalCartons: number;
  totalReceived: number;
}

export function summariseGoodsReceived(lines: GoodsReceivedLine[]): GoodsReceivedTotals {
  return {
    lineCount: lines.length,
    totalCartons: lines.reduce((a, l) => a + l.cartons, 0),
    totalReceived: lines.reduce((a, l) => a + l.received, 0),
  };
}
