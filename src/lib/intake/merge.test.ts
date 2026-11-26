import { describe, expect, it } from 'vitest';
import { documentRefKey, mergeExtractions } from './merge';
import type { AiDocumentExtractionResponse, StagedManifestItem } from '@/types/wms';

function line(sku: string): StagedManifestItem {
  return {
    sku_code: sku,
    product_name: sku,
    expected_cartons: 1,
    pack_size: 10,
    expected_total_qty: 10,
  } as StagedManifestItem;
}

function doc(
  container: string,
  skus: string[],
  extra: Partial<AiDocumentExtractionResponse> = {}
): AiDocumentExtractionResponse {
  return {
    supplier_name: 'Sample Supplier Pty. Ltd.',
    container_number: container,
    container_size: '40HC',
    items: skus.map(line),
    ...extra,
  };
}

describe('mergeExtractions', () => {
  it('passes a single extraction through unchanged', () => {
    const one = doc('TESTCNT0001', ['A']);
    expect(mergeExtractions([one])).toBe(one);
  });

  it('merges two documents for the SAME container into one line list', () => {
    const merged = mergeExtractions([
      doc('TESTCNT0001', ['A', 'B']),
      doc('TESTCNT0001', ['C']),
    ]);
    expect(merged.items.map((i) => i.sku_code)).toEqual(['A', 'B', 'C']);
    expect(merged.containers).toBeUndefined();
    expect(merged.items.every((i) => (i.container_sequence || 1) === 1)).toBe(true);
  });

  it('keeps different containers as one consignment with sequences', () => {
    const merged = mergeExtractions([
      doc('MSCU1234567', ['A']),
      doc('TESTCNT0002', ['B', 'C']),
    ]);
    expect(merged.containers?.map((c) => c.container_number)).toEqual([
      'MSCU1234567',
      'TESTCNT0002',
    ]);
    expect(merged.items.find((i) => i.sku_code === 'A')?.container_sequence).toBe(1);
    expect(merged.items.find((i) => i.sku_code === 'C')?.container_sequence).toBe(2);
    expect(merged.container_number).toBe('MSCU1234567');
  });

  it('folds a CONT-PENDING document into the first container', () => {
    const merged = mergeExtractions([
      doc('TESTCNT0001', ['A']),
      doc('CONT-PENDING', ['B']),
    ]);
    expect(merged.containers).toBeUndefined();
    expect(merged.items.map((i) => i.sku_code)).toEqual(['A', 'B']);
  });

  it('keeps placeholder documents with DIFFERENT refs as separate containers (Phase 16)', () => {
    const merged = mergeExtractions([
      doc('CONT-PENDING', ['A'], { document_ref: '451033848' }),
      doc('CONT-PENDING', ['B', 'C'], { document_ref: '451033417' }),
      doc('CONT-PENDING', ['D'], { document_ref: '451033961' }),
    ]);
    expect(merged.containers).toHaveLength(3);
    expect(merged.containers?.map((c) => c.document_ref)).toEqual([
      '451033848',
      '451033417',
      '451033961',
    ]);
    expect(merged.items.find((i) => i.sku_code === 'A')?.container_sequence).toBe(1);
    expect(merged.items.find((i) => i.sku_code === 'C')?.container_sequence).toBe(2);
    expect(merged.items.find((i) => i.sku_code === 'D')?.container_sequence).toBe(3);
  });

  it('merges placeholder documents sharing the SAME ref (split shipment, Phase 16)', () => {
    const merged = mergeExtractions([
      doc('CONT-PENDING', ['A'], { document_ref: '451033417' }),
      doc('CONT-PENDING', ['B'], { document_ref: '451033417' }),
    ]);
    expect(merged.containers).toBeUndefined();
    expect(merged.items.map((i) => i.sku_code)).toEqual(['A', 'B']);
  });

  it('carries warnings from every document', () => {
    const merged = mergeExtractions([
      doc('TESTCNT0001', ['A'], { warnings: ['w1'] }),
      doc('TESTCNT0001', ['B'], { warnings: ['w2'] }),
    ]);
    expect(merged.warnings).toEqual(['w1', 'w2']);
  });

  it('Phase 24: carries each document PO number onto its container group', () => {
    const merged = mergeExtractions([
      doc('CONT-PENDING', ['A'], { document_ref: 'INV-A', po_number: '1000001' }),
      doc('CONT-PENDING', ['B'], { document_ref: 'INV-B', po_number: '1000002' }),
    ]);
    expect(merged.containers?.map((c) => c.po_number)).toEqual(['1000001', '1000002']);
    expect(merged.po_number).toBe('1000001');
  });
  it('Phase 25: sums printed totals across each container group', () => {
    const merged = mergeExtractions([
      doc('CONT-PENDING', ['A'], { document_ref: 'INV-A', printed_totals: { cartons: 100, units: 1000 } }),
      doc('CONT-PENDING', ['B'], { document_ref: 'INV-A', printed_totals: { cartons: 50 } }),
      doc('CONT-PENDING', ['C'], { document_ref: 'INV-B', printed_totals: { units: 700 } }),
    ]);
    expect(merged.containers?.[0].printed_totals).toEqual({ cartons: 150, units: 1000 });
    expect(merged.containers?.[1].printed_totals).toEqual({ units: 700 });
    expect(merged.printed_totals).toEqual({ cartons: 150, units: 1700 });
  });
});

describe('documentRefKey (Phase 36 duplicate detection)', () => {
  it('normalises case and whitespace', () => {
    expect(documentRefKey(doc('CONT-PENDING', [], { document_ref: ' 4510 36373 ' }))).toBe('451036373');
  });

  it('returns empty for missing or implausibly short refs — never deduped', () => {
    expect(documentRefKey(doc('CONT-PENDING', []))).toBe('');
    expect(documentRefKey(doc('CONT-PENDING', [], { document_ref: '12' }))).toBe('');
  });
});
