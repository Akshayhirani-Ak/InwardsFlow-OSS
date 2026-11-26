import { describe, expect, it } from 'vitest';
import { buildGoodsReceivedLines, summariseGoodsReceived } from './goods-received';
import type { ExpectedItem, PalletEntry } from '@/types/wms';

function item(id: string, sku: string, supplier: string | null, name = sku): ExpectedItem {
  return {
    id,
    container_id: 'c1',
    sku_code: sku,
    supplier_sku_code: supplier,
    product_name: name,
    expected_cartons: 10,
    pack_size: 10,
    expected_total_qty: 100,
  };
}

function entry(itemId: string, good: number, damaged = 0, cartons = 0, voided = false): PalletEntry {
  return {
    id: `e-${itemId}-${good}-${damaged}-${cartons}-${voided}`,
    container_id: 'c1',
    pallet_id: 'p1',
    item_id: itemId,
    cartons_counted: cartons,
    pack_size_used: 10,
    good_qty: good,
    damaged_qty: damaged,
    qc_status: 'PASS',
    qc_reason_code: 'PASS',
    operator_name: 'op',
    is_voided: voided,
    created_at: '2026-11-20T00:00:00Z',
  } as PalletEntry;
}

const ITEMS = [
  item('i1', 'DEMO150', '6000001', 'Sample Aluminium Flexible Ducting 150mm x 6m'),
  item('i2', 'DEMO100', '6000002', 'Sample Aluminium Flexible Ducting 100mm x 6m'),
  item('i3', 'DEMO999', null, 'Not sent line'),
  item('i4', 'DEMO125', '6000003', 'Fully damaged line'),
];

describe('buildGoodsReceivedLines', () => {
  it('lists only lines with good units, sorted by product code', () => {
    const lines = buildGoodsReceivedLines(ITEMS, [
      entry('i1', 1498, 0, 60),
      entry('i2', 150, 0, 15),
      entry('i4', 0, 40, 4), // damaged only — not received
    ]);
    expect(lines.map((l) => l.productCode)).toEqual(['DEMO100', 'DEMO150']);
  });

  it('sums multiple entries and ignores voided ones', () => {
    const lines = buildGoodsReceivedLines(ITEMS, [
      entry('i1', 1000, 0, 40),
      entry('i1', 498, 0, 20),
      entry('i1', 500, 0, 20, true), // voided — must not count
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].received).toBe(1498);
    expect(lines[0].cartons).toBe(60);
  });

  it('does not count cartons from wholly-damaged entries toward a received line', () => {
    const lines = buildGoodsReceivedLines(ITEMS, [
      entry('i1', 100, 0, 10),
      entry('i1', 0, 30, 3), // damaged cartons only
    ]);
    expect(lines[0].received).toBe(100);
    expect(lines[0].cartons).toBe(10);
  });

  it('carries the supplier code and defaults the unit to pcs', () => {
    const lines = buildGoodsReceivedLines(ITEMS, [entry('i1', 10, 0, 1)]);
    expect(lines[0].supplierCode).toBe('6000001');
    expect(lines[0].unit).toBe('pcs');
    const noSupplier = buildGoodsReceivedLines(ITEMS, [entry('i3', 5, 0, 1)]);
    expect(noSupplier[0].supplierCode).toBeNull();
  });

  it('returns nothing when nothing good was counted', () => {
    expect(buildGoodsReceivedLines(ITEMS, [])).toEqual([]);
    expect(buildGoodsReceivedLines(ITEMS, [entry('i4', 0, 12, 2)])).toEqual([]);
  });
});

describe('summariseGoodsReceived', () => {
  it('totals lines, cartons and received units', () => {
    const lines = buildGoodsReceivedLines(ITEMS, [
      entry('i1', 1498, 0, 60),
      entry('i2', 150, 0, 15),
    ]);
    expect(summariseGoodsReceived(lines)).toEqual({
      lineCount: 2,
      totalCartons: 75,
      totalReceived: 1648,
    });
  });
});
