import { describe, expect, it } from 'vitest';
import {
  accumulateScans,
  resolveScanItem,
  scanUnits,
  scannedItemOrder,
  type ScanLogEntry,
} from './scan';
import type { ExpectedItem } from '@/types/wms';

function item(id: string, sku: string, supplier: string | null, pack = 10): ExpectedItem {
  return {
    id,
    container_id: 'c1',
    sku_code: sku,
    supplier_sku_code: supplier,
    product_name: sku,
    expected_cartons: 40,
    pack_size: pack,
    expected_total_qty: 40 * pack,
  };
}

// Fixtures mirror the Phase 11 dummy-invoice container: barcode-keyed
// products whose lines also carry the supplier identcode.
const ITEMS = [
  item('i1', '0010000000016', 'SUPP000010', 25),
  item('i2', '0010000000023', 'SUPP000011', 10),
  item('i3', 'SUPP000012', null, 10),
];
const ALIASES = { SUPP000010: '0010000000016', SUPP000011: '0010000000023' };

describe('resolveScanItem', () => {
  it('matches the box barcode directly (the product SKU)', () => {
    expect(resolveScanItem(ITEMS, ALIASES, '0010000000016')?.id).toBe('i1');
  });

  it('matches the supplier code stored on the manifest line', () => {
    expect(resolveScanItem(ITEMS, ALIASES, 'SUPP000011')?.id).toBe('i2');
  });

  it('matches through the alias map when the line carries no code', () => {
    const noLineCodes = ITEMS.map((i) => ({ ...i, supplier_sku_code: null }));
    expect(resolveScanItem(noLineCodes, ALIASES, 'SUPP000010')?.id).toBe('i1');
  });

  it('finds a supplier-code-keyed product by its own SKU', () => {
    expect(resolveScanItem(ITEMS, ALIASES, 'SUPP000012')?.id).toBe('i3');
  });

  it('is case-insensitive and trims scanner whitespace', () => {
    expect(resolveScanItem(ITEMS, ALIASES, '  supp000010 ')?.id).toBe('i1');
  });

  it('returns null for a code that is not on the manifest', () => {
    expect(resolveScanItem(ITEMS, ALIASES, '9999999999999')).toBeNull();
    expect(resolveScanItem(ITEMS, ALIASES, '')).toBeNull();
  });
});

describe('accumulateScans + scanUnits', () => {
  const log: ScanLogEntry[] = [
    { itemId: 'i1', damaged: false },
    { itemId: 'i1', damaged: false },
    { itemId: 'i2', damaged: false },
    { itemId: 'i1', damaged: true },
    { itemId: 'i2', damaged: false },
  ];

  it('counts good and damaged cartons per item', () => {
    const acc = accumulateScans(log);
    expect(acc['i1']).toEqual({ goodCartons: 2, damagedCartons: 1 });
    expect(acc['i2']).toEqual({ goodCartons: 2, damagedCartons: 0 });
  });

  it('converts cartons to units by the item pack size (400-line: 10 per box)', () => {
    expect(scanUnits({ goodCartons: 40, damagedCartons: 0 }, 10)).toEqual({
      cartons: 40,
      goodQty: 400,
      damagedQty: 0,
    });
    expect(scanUnits({ goodCartons: 2, damagedCartons: 1 }, 25)).toEqual({
      cartons: 3,
      goodQty: 50,
      damagedQty: 25,
    });
  });

  it('keeps first-scan order for recording', () => {
    expect(scannedItemOrder(log)).toEqual(['i1', 'i2']);
  });
});

describe('resolveScanItem — Phase 27 GS1 / GTIN-14 forms', () => {
  // The batten from the floor photos: the product is keyed by its
  // single-pack EAN-13, but the outer carton only carries the GS1
  // string and the GTIN-14.
  const BATTEN = item('i9', '0010000000177', 'SUPP000013', 20);
  const WITH_BATTEN = [...ITEMS, BATTEN];

  it('matches the full GS1-128 string from the carton label', () => {
    expect(resolveScanItem(WITH_BATTEN, ALIASES, '(02)00010000000177(37)000020')?.id).toBe('i9');
  });

  it('matches the raw concatenated GS1 string a scanner emits', () => {
    expect(resolveScanItem(WITH_BATTEN, ALIASES, '020001000000017737000020')?.id).toBe('i9');
  });

  it('matches a bare GTIN-14 scan via conversion to the EAN-13', () => {
    expect(resolveScanItem(WITH_BATTEN, ALIASES, '00010000000177')?.id).toBe('i9');
  });

  it('still matches the plain EAN-13 directly', () => {
    expect(resolveScanItem(WITH_BATTEN, ALIASES, '0010000000177')?.id).toBe('i9');
  });

  it('a GS1 scan of a different product resolves to THAT product (wrong-code path)', () => {
    // The wide batten's EAN is not on this container: its GS1 string must
    // not resolve at all here…
    expect(resolveScanItem(WITH_BATTEN, ALIASES, '(02)00010000000207(37)000006')).toBeNull();
    // …but on a container carrying it, the same scan resolves to it, so
    // the pad can name the real product on the Wrong code line.
    const WIDE = item('i10', '0010000000207', 'SUPP000001', 6);
    expect(resolveScanItem([...ITEMS, WIDE], ALIASES, '(02)00010000000207(37)000006')?.id).toBe('i10');
  });

  it('a GS1 string with a broken check digit resolves nothing', () => {
    expect(resolveScanItem(WITH_BATTEN, ALIASES, '(02)00010000000178(37)000020')).toBeNull();
  });
});
