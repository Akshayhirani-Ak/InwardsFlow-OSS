import { describe, expect, it } from 'vitest';
import { comparePrintedTotals, stagedTotals, sumPrintedTotals } from './totals';
import type { StagedManifestItem } from '@/types/wms';

function line(cartons: number, total: number, partial = 0): StagedManifestItem {
  return {
    sku_code: 'X',
    product_name: 'X',
    expected_cartons: cartons,
    pack_size: total / Math.max(cartons, 1),
    expected_total_qty: total,
    partial_cartons: partial,
  } as StagedManifestItem;
}

describe('stagedTotals', () => {
  it('sums lines, physical cartons (full + partial) and units', () => {
    expect(stagedTotals([line(8, 200), line(8, 30, 1), line(4, 100)])).toEqual({
      lines: 3,
      cartons: 21,
      units: 330,
    });
  });
});

describe('comparePrintedTotals', () => {
  it('passes when staged matches printed (the Mainchain ground truth)', () => {
    const staged = { lines: 54, cartons: 995, units: 12046 };
    expect(comparePrintedTotals(staged, { lines: 54, cartons: 995, units: 12046 })).toEqual([]);
  });

  it('flags the units gap the Phase 19 retest actually produced', () => {
    // The model staged 12,054 units against a document whose true total
    // was 12,046 — this check exists to catch exactly that.
    const staged = { lines: 54, cartons: 995, units: 12054 };
    expect(comparePrintedTotals(staged, { units: 12046 })).toEqual([
      { field: 'units', printed: 12046, staged: 12054 },
    ]);
  });

  it('compares only the figures the document printed', () => {
    const staged = { lines: 10, cartons: 40, units: 900 };
    expect(comparePrintedTotals(staged, { cartons: 40 })).toEqual([]);
    expect(comparePrintedTotals(staged, {})).toEqual([]);
    expect(comparePrintedTotals(staged, undefined)).toEqual([]);
    expect(comparePrintedTotals(staged, { lines: 0, cartons: 0 })).toEqual([]);
  });

  it('reports every mismatched field', () => {
    const staged = { lines: 9, cartons: 41, units: 900 };
    expect(comparePrintedTotals(staged, { lines: 10, cartons: 40, units: 900 })).toEqual([
      { field: 'lines', printed: 10, staged: 9 },
      { field: 'cartons', printed: 40, staged: 41 },
    ]);
  });
});

describe('sumPrintedTotals', () => {
  it('adds figures across merged documents', () => {
    expect(
      sumPrintedTotals([{ cartons: 100, units: 1000 }, { cartons: 50 }, undefined, { units: 500 }])
    ).toEqual({ cartons: 150, units: 1500 });
  });

  it('returns undefined when no document printed totals', () => {
    expect(sumPrintedTotals([undefined, {}, null])).toBeUndefined();
  });
});
