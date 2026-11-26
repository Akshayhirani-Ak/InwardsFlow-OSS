import { describe, expect, it } from 'vitest';
import { cleanPoNumber, collectPoNumbers, deriveConsignmentRef } from './naming';

describe('cleanPoNumber', () => {
  it('accepts a plain buyer PO number', () => {
    expect(cleanPoNumber('1000001')).toBe('1000001');
    expect(cleanPoNumber(' 1000001 ')).toBe('1000001');
    expect(cleanPoNumber('PO-8821')).toBe('PO-8821');
  });

  it('strips inner spaces and uppercases', () => {
    expect(cleanPoNumber('po 8821')).toBe('PO8821');
  });

  it('rejects junk the model might return', () => {
    expect(cleanPoNumber('')).toBe('');
    expect(cleanPoNumber('N/A')).toBe('');
    expect(cleanPoNumber('Your order No.')).toBe('');
    expect(cleanPoNumber('123')).toBe(''); // too short
    expect(cleanPoNumber('1000001 — copy')).toBe('');
    expect(cleanPoNumber(null)).toBe('');
    expect(cleanPoNumber(1000001)).toBe('');
    expect(cleanPoNumber('x'.repeat(21))).toBe('');
  });
});

describe('collectPoNumbers', () => {
  it('gathers top-level and per-container POs in order, deduped', () => {
    expect(
      collectPoNumbers({
        po_number: '1000001',
        containers: [{ po_number: '1000002' }, { po_number: '1000001' }, { po_number: '' }],
      })
    ).toEqual(['1000001', '1000002']);
  });

  it('returns nothing when no document stated a PO', () => {
    expect(collectPoNumbers({ po_number: '', containers: [{}, {}] })).toEqual([]);
    expect(collectPoNumbers({})).toEqual([]);
  });
});

describe('deriveConsignmentRef', () => {
  it('names the consignment by its single PO', () => {
    expect(deriveConsignmentRef(['1000001'], '900000001')).toBe('1000001');
  });

  it('names a multi-PO delivery by all its POs', () => {
    expect(deriveConsignmentRef(['1000003', '1000001', '1000002'], 'INV-1')).toBe(
      '1000003 · 1000001 · 1000002'
    );
  });

  it('falls back to the document ref when no PO was stated', () => {
    expect(deriveConsignmentRef([], '900000001')).toBe('900000001');
    expect(deriveConsignmentRef([], '')).toBe('');
  });
});
