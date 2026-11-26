import { describe, it, expect } from 'vitest';
import {
  groupProductPiles,
  splitProducts,
  palletSummaries,
  containerTotals,
} from './organise';
import type { ExpectedItem, Pallet, PalletEntry } from '@/types/wms';

const item = (id: string, sku: string, name: string): ExpectedItem =>
  ({
    id,
    container_id: 'c1',
    sku_code: sku,
    product_name: name,
    expected_cartons: 0,
    pack_size: 10,
    expected_total_qty: 0,
    partial_cartons: 0,
    expected_partial_qty: 0,
  }) as ExpectedItem;

const pallet = (id: string, code: string, status = 'open'): Pallet =>
  ({
    id,
    container_id: 'c1',
    pallet_code: code,
    status,
  }) as Pallet;

const entry = (
  id: string,
  palletId: string,
  itemId: string,
  cartons: number,
  good: number,
  damaged = 0
): PalletEntry =>
  ({
    id,
    container_id: 'c1',
    pallet_id: palletId,
    item_id: itemId,
    cartons_counted: cartons,
    pack_size_used: 10,
    good_qty: good,
    damaged_qty: damaged,
    is_voided: false,
  }) as PalletEntry;

// The demo shape he asked for: OS1 = 200 split 50 / 100 / 50 over
// PLT-001 / PLT-003 / PLT-005, plus one single-pallet product.
const items = [item('i-os1', 'OS1', 'Floodlight'), item('i-b', 'DMO02', 'Batten')];
const pallets = [
  pallet('p1', 'PLT-001'),
  pallet('p2', 'PLT-002'),
  pallet('p3', 'PLT-003'),
  pallet('p5', 'PLT-005'),
];
const entries = [
  entry('e1', 'p1', 'i-os1', 5, 50),
  entry('e2', 'p3', 'i-os1', 10, 100),
  entry('e3', 'p5', 'i-os1', 5, 50),
  entry('e4', 'p1', 'i-b', 12, 120),
];

describe('splitProducts', () => {
  it('finds OS1 split over three pallets with the biggest pile as target', () => {
    const splits = splitProducts(entries, items, pallets);
    expect(splits).toHaveLength(1);
    expect(splits[0].skuCode).toBe('OS1');
    expect(splits[0].totalUnits).toBe(200);
    expect(splits[0].totalBoxes).toBe(20);
    expect(splits[0].piles.map((p) => [p.palletCode, p.units])).toEqual([
      ['PLT-001', 50],
      ['PLT-003', 100],
      ['PLT-005', 50],
    ]);
    expect(splits[0].suggestedTargetPalletId).toBe('p3');
  });

  it('ignores single-pallet products and voided/zero entries', () => {
    const voided = { ...entry('e9', 'p2', 'i-b', 3, 30), is_voided: true };
    const splits = splitProducts([...entries, voided], items, pallets);
    expect(splits.map((s) => s.skuCode)).toEqual(['OS1']);
  });
});

describe('palletSummaries', () => {
  it('summarises contents per pallet and marks empties', () => {
    const sums = palletSummaries(entries, items, pallets);
    const p1 = sums.find((s) => s.palletCode === 'PLT-001');
    expect(p1?.products).toHaveLength(2);
    expect(p1?.units).toBe(170);
    expect(p1?.boxes).toBe(17);
    const p2 = sums.find((s) => s.palletCode === 'PLT-002');
    expect(p2?.isEmpty).toBe(true);
    expect(p2?.units).toBe(0);
  });
});

describe('containerTotals', () => {
  it('totals every live entry — the invariant a merge must preserve', () => {
    expect(containerTotals(entries)).toEqual({ boxes: 32, units: 320 });
    const withVoid = [
      ...entries,
      { ...entry('e9', 'p2', 'i-b', 3, 30), is_voided: true },
    ];
    expect(containerTotals(withVoid)).toEqual({ boxes: 32, units: 320 });
  });
});

describe('groupProductPiles', () => {
  it('keeps pile entries oldest-first for FIFO transfers', () => {
    const two = [
      entry('newer', 'p1', 'i-os1', 2, 20),
      entry('older', 'p1', 'i-os1', 3, 30),
    ];
    const [os1] = groupProductPiles(two, items, pallets);
    expect(os1.piles[0].entries.map((e) => e.id)).toEqual(['newer', 'older'].reverse());
  });
});
