// InwardsFlow — Phase 25 printed-totals cross-check (pure, unit-tested).
//
// The AI also reads the totals the document itself prints (its summary
// or footer). At publish, the staged lines are summed and compared
// against those printed figures, per container unit: a document whose
// footer says 12,046 units while the staged lines total 12,054 has a
// wrong line somewhere, and the operator hears about it BEFORE the
// consignment is published — not after the count disagrees on the floor.
// Figures the document doesn't print are never compared. A mismatch
// warns; publishing anyway needs a typed reason (kept on the record).

import type { PrintedTotals, StagedManifestItem } from '@/types/wms';

export interface StagedTotals {
  lines: number;
  cartons: number;
  units: number;
}

export function stagedTotals(items: StagedManifestItem[]): StagedTotals {
  return {
    lines: items.length,
    // A document's printed carton count is physical boxes: full cartons
    // plus the partial/remainder boxes.
    cartons: items.reduce(
      (a, i) => a + (i.expected_cartons || 0) + (i.partial_cartons || 0),
      0
    ),
    units: items.reduce((a, i) => a + (i.expected_total_qty || 0), 0),
  };
}

export interface TotalsMismatch {
  field: 'lines' | 'cartons' | 'units';
  printed: number;
  staged: number;
}

const FIELDS: Array<keyof StagedTotals> = ['lines', 'cartons', 'units'];

export function comparePrintedTotals(
  staged: StagedTotals,
  printed?: PrintedTotals | null
): TotalsMismatch[] {
  if (!printed) return [];
  const out: TotalsMismatch[] = [];
  for (const f of FIELDS) {
    const p = printed[f];
    if (typeof p === 'number' && p > 0 && staged[f] !== p) {
      out.push({ field: f, printed: p, staged: staged[f] });
    }
  }
  return out;
}

/** Sum printed totals across documents (a field survives if any doc states it). */
export function sumPrintedTotals(
  list: Array<PrintedTotals | undefined | null>
): PrintedTotals | undefined {
  const out: PrintedTotals = {};
  let any = false;
  for (const t of list) {
    if (!t) continue;
    for (const f of FIELDS) {
      const v = t[f];
      if (typeof v === 'number' && v > 0) {
        out[f] = (out[f] || 0) + v;
        any = true;
      }
    }
  }
  return any ? out : undefined;
}
