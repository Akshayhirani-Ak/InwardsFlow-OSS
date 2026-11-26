import { describe, expect, it } from 'vitest';
import { salvageManifest } from './salvage';

const GOOD_LINE = {
  sku_code: '0010000000016',
  barcode: '0010000000016',
  supplier_code: 'SUPP000010',
  product_name: 'L 8W/640 FLH1 SAMPLE',
  expected_cartons: 8,
  pack_size: 25,
  expected_total_qty: 200,
  uom: 'EA',
  ai_flag: 'OK',
};

function doc(items: unknown[], header: Record<string, unknown> = {}) {
  return {
    container_number: 'TESTCNT0009',
    supplier_name: 'Sample Supplier Pty. Ltd.',
    container_size: '40HC',
    document_ref: '4599999900',
    dock_door: 'DOOR-01',
    counting_mode: 'GUIDED',
    ...header,
    items,
  };
}

describe('salvageManifest', () => {
  it('passes a clean manifest through untouched', () => {
    const { manifest, dropped } = salvageManifest(doc([GOOD_LINE, GOOD_LINE]));
    expect(manifest?.items).toHaveLength(2);
    expect(dropped).toEqual([]);
  });

  it('salvages the good lines when one line is broken (Phase 13 core case)', () => {
    const broken = { ...GOOD_LINE, sku_code: '', product_name: '' };
    const { manifest, dropped } = salvageManifest(doc([GOOD_LINE, broken, GOOD_LINE]));
    expect(manifest?.items).toHaveLength(2);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].line).toBe(2);
  });

  it('maps an invented ai_flag to CHECK instead of failing the line', () => {
    const weird = { ...GOOD_LINE, ai_flag: 'LOW_CONFIDENCE' };
    const { manifest, dropped } = salvageManifest(doc([weird]));
    expect(dropped).toEqual([]);
    expect(manifest?.items[0].ai_flag).toBe('CHECK_HANDWRITING_OR_MATH');
  });

  it('recovers a missing total from cartons x pack', () => {
    const noTotal: Record<string, unknown> = { ...GOOD_LINE };
    delete noTotal.expected_total_qty;
    const { manifest, dropped } = salvageManifest(doc([noTotal]));
    expect(dropped).toEqual([]);
    expect(manifest?.items[0].expected_total_qty).toBe(200);
  });

  it('defaults an off-enum container size instead of failing the document', () => {
    const { manifest } = salvageManifest(doc([GOOD_LINE], { container_size: 'HIGH CUBE' }));
    expect(manifest?.container_size).toBe('40HC');
  });

  it('falls back to CONT-PENDING when the container number is unusable', () => {
    const { manifest } = salvageManifest(doc([GOOD_LINE], { container_number: '' }));
    expect(manifest?.container_number).toBe('CONT-PENDING');
  });

  it('fails only when no line survives', () => {
    const { manifest, dropped } = salvageManifest(
      doc([{ sku_code: '', product_name: '' }])
    );
    expect(manifest).toBeNull();
    expect(dropped).toHaveLength(1);
  });

  it('rounds near-integer float quantities instead of dropping the line (Phase 16)', () => {
    const floaty = { ...GOOD_LINE, pack_size: 24.999999, expected_total_qty: 200.000001 };
    const { manifest, dropped } = salvageManifest(doc([floaty]));
    expect(dropped).toEqual([]);
    expect(manifest?.items[0].pack_size).toBe(25);
    expect(manifest?.items[0].expected_total_qty).toBe(200);
  });

  it('derives a fractional total from cartons x pack and reports the repair (Phase 16/18)', () => {
    const fracTotal = { ...GOOD_LINE, expected_total_qty: 200.4 };
    const { manifest, dropped, repaired } = salvageManifest(doc([fracTotal]));
    expect(dropped).toEqual([]);
    expect(manifest?.items[0].expected_total_qty).toBe(200);
    expect(repaired).toHaveLength(1);
    expect(repaired[0].note).toContain('total quantity set to 200');
  });

  it('derives a ratio-artefact pack size from exact division and reports it (Phase 18)', () => {
    // A real supplier failure: 8 cartons, 24 units, pack read as 0.33.
    const artefact = { ...GOOD_LINE, expected_cartons: 8, pack_size: 0.333, expected_total_qty: 24 };
    const { manifest, dropped, repaired } = salvageManifest(doc([artefact]));
    expect(dropped).toEqual([]);
    expect(manifest?.items[0].pack_size).toBe(3);
    expect(repaired).toHaveLength(1);
    expect(repaired[0].note).toContain('pack size set to 3 from 24 units ÷ 8 cartons');
  });

  it('repairs a far-off fractional total from the line arithmetic, flagged (Phase 18)', () => {
    const off = { ...GOOD_LINE, expected_total_qty: 207.5 };
    const { manifest, dropped, repaired } = salvageManifest(doc([off]));
    expect(dropped).toEqual([]);
    expect(manifest?.items[0].expected_total_qty).toBe(200);
    expect(repaired).toHaveLength(1);
  });

  it('still drops a line with TWO fractional quantities (Phase 18)', () => {
    const twoFrac = { ...GOOD_LINE, expected_cartons: 8.5, expected_total_qty: 207.5 };
    const { manifest, dropped } = salvageManifest(doc([GOOD_LINE, twoFrac]));
    expect(manifest?.items).toHaveLength(1);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toContain('expected_cartons');
  });

  it('stages a non-uniform pack via full + partial cartons, figures exact (Phase 19)', () => {
    // The real line: 30 units over 8 cartons, pack read as 3.75.
    const nonUniform = {
      ...GOOD_LINE,
      sku_code: '0010000000030',
      expected_cartons: 8,
      pack_size: 3.75,
      expected_total_qty: 30,
    };
    const { manifest, dropped, repaired } = salvageManifest(doc([nonUniform]));
    expect(dropped).toEqual([]);
    const line = manifest?.items[0];
    expect(line?.expected_cartons).toBe(7);
    expect(line?.pack_size).toBe(4);
    expect(line?.partial_cartons).toBe(1);
    expect(line?.expected_partial_qty).toBe(2);
    expect(line?.expected_total_qty).toBe(30);
    expect(line?.ai_flag).toBe('CHECK_HANDWRITING_OR_MATH');
    expect(repaired).toHaveLength(1);
    expect(repaired[0].note).toContain('not a uniform pack');
  });

  it('stages a fractional carton count via full + partial, total exact (Phase 19)', () => {
    const fracCartons = { ...GOOD_LINE, expected_cartons: 8.2, pack_size: 4, expected_total_qty: 30 };
    const { manifest, dropped } = salvageManifest(doc([fracCartons]));
    expect(dropped).toEqual([]);
    expect(manifest?.items[0].expected_cartons).toBe(7);
    expect(manifest?.items[0].partial_cartons).toBe(1);
    expect(manifest?.items[0].expected_partial_qty).toBe(2);
    expect(manifest?.items[0].expected_total_qty).toBe(30);
  });

  it('still drops a genuinely mixed pack it cannot represent (Phase 19)', () => {
    // 100 units over 30 cartons at ~3.33: mixed 3s and 4s, no clean
    // full + one-partial shape — the operator must read this line.
    const mixed = { ...GOOD_LINE, expected_cartons: 30, pack_size: 3.33, expected_total_qty: 100 };
    const { manifest, dropped } = salvageManifest(doc([GOOD_LINE, mixed]));
    expect(manifest?.items).toHaveLength(1);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toContain('pack_size');
  });

  it('rounds a near-integer float in the half-box fields instead of dropping (Phase 17)', () => {
    const partial = {
      ...GOOD_LINE,
      partial_cartons: 1.000001,
      expected_partial_qty: 12.999999,
    };
    const { manifest, dropped } = salvageManifest(doc([partial]));
    expect(dropped).toEqual([]);
    expect(manifest?.items[0].partial_cartons).toBe(1);
    expect(manifest?.items[0].expected_partial_qty).toBe(13);
  });

  it('names the failing field in the drop reason (Phase 17)', () => {
    // pack 2.5 with 25 units in 8 cartons: 25 does not divide by 8, so
    // no exact derivation exists and the line still drops — by field name.
    const off = { ...GOOD_LINE, expected_cartons: 8, pack_size: 2.5, expected_total_qty: 25 };
    const { dropped } = salvageManifest(doc([off]));
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toContain('pack_size');
  });
  it('Phase 24: keeps a plausible PO number and drops junk', () => {
    const good = salvageManifest(doc([GOOD_LINE], { po_number: ' 1000001 ' }));
    expect(good.manifest?.po_number).toBe('1000001');
    const junk = salvageManifest(doc([GOOD_LINE], { po_number: 'Your order No.' }));
    expect(junk.manifest?.po_number).toBe('');
    const absent = salvageManifest(doc([GOOD_LINE]));
    expect(absent.manifest?.po_number).toBe('');
  });
  it('Phase 25: printed totals survive figure-by-figure cleaning only', () => {
    const { manifest } = salvageManifest(
      doc([GOOD_LINE], { printed_totals: { lines: 54, cartons: 995.0, units: 'lots' } })
    );
    expect(manifest?.printed_totals).toEqual({ lines: 54, cartons: 995 });
    const none = salvageManifest(doc([GOOD_LINE], { printed_totals: { units: 0 } }));
    expect(none.manifest?.printed_totals).toBeUndefined();
  });
});

describe('salvageManifest — Phase 36 integer quantity disagreement (printed total governs)', () => {
  it('keeps 13 units in 2 cartons when the model says 6 per carton — the live U-bracket case', () => {
    const line = { ...GOOD_LINE, expected_cartons: 2, pack_size: 6, expected_total_qty: 13 };
    const { manifest, repaired, dropped } = salvageManifest(doc([line]));
    expect(dropped).toEqual([]);
    const item = manifest?.items[0];
    expect(item?.expected_total_qty).toBe(13);
    expect(item?.pack_size).toBe(7);
    expect(item?.expected_cartons).toBe(1);
    expect(item?.partial_cartons).toBe(1);
    expect(item?.expected_partial_qty).toBe(6);
    expect(item?.ai_flag).toBe('CHECK_HANDWRITING_OR_MATH');
    expect(repaired).toHaveLength(1);
    expect(repaired[0].note).toMatch(/printed total of 13/);
  });

  it('stages 30 units over 8 cartons at a stated pack of 4 as 7 full + 1 partial of 2', () => {
    const line = { ...GOOD_LINE, expected_cartons: 8, pack_size: 4, expected_total_qty: 30 };
    const { manifest, repaired } = salvageManifest(doc([line]));
    const item = manifest?.items[0];
    expect(item?.expected_total_qty).toBe(30);
    expect(item?.pack_size).toBe(4);
    expect(item?.expected_cartons).toBe(7);
    expect(item?.partial_cartons).toBe(1);
    expect(item?.expected_partial_qty).toBe(2);
    expect(repaired).toHaveLength(1);
  });

  it('corrects a uniformly wrong pack (24 units, 4 cartons, stated pack 5 → 6)', () => {
    const line = { ...GOOD_LINE, expected_cartons: 4, pack_size: 5, expected_total_qty: 24 };
    const { manifest, repaired } = salvageManifest(doc([line]));
    const item = manifest?.items[0];
    expect(item?.expected_total_qty).toBe(24);
    expect(item?.pack_size).toBe(6);
    expect(item?.expected_cartons).toBe(4);
    expect(item?.partial_cartons ?? 0).toBe(0);
    expect(repaired).toHaveLength(1);
  });

  it('reduces the carton count when the total fills fewer cartons than stated', () => {
    const line = { ...GOOD_LINE, expected_cartons: 5, pack_size: 1, expected_total_qty: 3 };
    const { manifest, repaired } = salvageManifest(doc([line]));
    const item = manifest?.items[0];
    expect(item?.expected_total_qty).toBe(3);
    expect(item?.expected_cartons).toBe(3);
    expect(repaired).toHaveLength(1);
  });

  it('leaves a consistent line completely untouched', () => {
    const { manifest, repaired } = salvageManifest(doc([GOOD_LINE]));
    expect(repaired).toEqual([]);
    expect(manifest?.items[0].expected_cartons).toBe(8);
    expect(manifest?.items[0].pack_size).toBe(25);
    expect(manifest?.items[0].expected_total_qty).toBe(200);
  });
});
