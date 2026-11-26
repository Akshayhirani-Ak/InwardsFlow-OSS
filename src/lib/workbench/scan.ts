// InwardsFlow — Phase 12 scan-count helpers (pure, unit-tested).
//
// Scan mode turns the tally pad into a rapid counter: every scan of a box
// adds ONE carton of that product. A scanned code can reach its product
// three ways, in this order:
//   1. the product's own SKU (for barcode-keyed products, the box barcode)
//   2. the supplier code stored on the container's manifest line
//   3. the Phase 11 alias map (supplier code -> canonical SKU)
//
// Phase 27: suppliers print MORE than the product code on the box. An
// supplier outer carton carries a GS1-128 string — (02) + GTIN-14
// + (37) + count — and the GTIN-14 itself carries a packaging digit in
// front of the single-pack EAN. Scanned raw, both forms matched nothing
// and the right box was rejected. scanCandidates() expands a raw scan
// into every code it legitimately carries (raw, GS1 GTIN, GTIN-14 →
// EAN-13, UPC-A → EAN-13) and the resolver tries them all through the
// same three-step chain.

import type { ExpectedItem } from '@/types/wms';
import { gtin14ToEan13, parseGs1 } from '@/lib/validation/gs1';
import { isValidGtin } from '@/lib/validation/gtin';

export interface ScanLogEntry {
  itemId: string;
  damaged: boolean;
}

export interface ScanAccumulation {
  goodCartons: number;
  damagedCartons: number;
}

export function normalizeScanCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Every code a raw scan legitimately carries, most specific first:
 * the raw code itself (today's behaviour), the GTIN inside a GS1
 * string, that GTIN-14 converted to the single-pack EAN-13, a bare
 * GTIN-14 converted the same way, and a UPC-A expanded to EAN-13.
 */
export function scanCandidates(rawCode: string): string[] {
  const code = normalizeScanCode(rawCode);
  if (!code) return [];
  const out: string[] = [];
  const push = (c?: string | null) => {
    if (c && !out.includes(c)) out.push(c);
  };
  push(code);
  const gs1 = parseGs1(code);
  if (gs1.gtin) {
    push(gs1.gtin);
    push(gtin14ToEan13(gs1.gtin));
  }
  const digits = code.replace(/[^0-9]/g, '');
  if (/^\d{14}$/.test(digits)) push(gtin14ToEan13(digits));
  if (/^\d{12}$/.test(digits) && isValidGtin(digits)) push('0' + digits);
  return out;
}

export function resolveScanItem(
  items: ExpectedItem[],
  aliasMap: Record<string, string>,
  rawCode: string
): ExpectedItem | null {
  for (const code of scanCandidates(rawCode)) {
    const bySku = items.find((i) => i.sku_code.toUpperCase() === code);
    if (bySku) return bySku;
    const byLineCode = items.find(
      (i) => (i.supplier_sku_code || '').toUpperCase() === code
    );
    if (byLineCode) return byLineCode;
    const target = aliasMap[code];
    if (target) {
      const hit = items.find((i) => i.sku_code.toUpperCase() === target);
      if (hit) return hit;
    }
  }
  return null;
}

export function accumulateScans(
  log: ScanLogEntry[]
): Record<string, ScanAccumulation> {
  const acc: Record<string, ScanAccumulation> = {};
  for (const entry of log) {
    if (!acc[entry.itemId]) {
      acc[entry.itemId] = { goodCartons: 0, damagedCartons: 0 };
    }
    if (entry.damaged) {
      acc[entry.itemId].damagedCartons += 1;
    } else {
      acc[entry.itemId].goodCartons += 1;
    }
  }
  return acc;
}

/** Item ids in the order they were first scanned (stable Record order). */
export function scannedItemOrder(log: ScanLogEntry[]): string[] {
  const seen: string[] = [];
  for (const entry of log) {
    if (!seen.includes(entry.itemId)) seen.push(entry.itemId);
  }
  return seen;
}

export function scanUnits(acc: ScanAccumulation, packSize: number): {
  cartons: number;
  goodQty: number;
  damagedQty: number;
} {
  const pack = packSize > 0 ? packSize : 1;
  return {
    cartons: acc.goodCartons + acc.damagedCartons,
    goodQty: acc.goodCartons * pack,
    damagedQty: acc.damagedCartons * pack,
  };
}
