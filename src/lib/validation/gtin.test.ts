import { describe, expect, it } from 'vitest';
import { gtinCheckDigit, isGtinShaped, isValidGtin, normalizeBarcode } from './gtin';

// Sample EAN-13s in the shape of a supplier invoice — the kind of
// document that exposes barcode problems: keying products by the
// supplier's internal identcode instead of the printed barcode.
const INVOICE_EANS = [
  '0010000000016', '0010000000023', '0010000000030', '0010000000047',
  '0010000000054', '0010000000061', '0010000000078', '0010000000085',
  '0010000000092', '0010000000108', '0010000000115', '0010000000122',
  '0010000000139', '0010000000146', '0010000000153', '0010000000160',
];

describe('gtin validation', () => {
  it('accepts every barcode from the sample invoice', () => {
    for (const ean of INVOICE_EANS) {
      expect(isValidGtin(ean), ean).toBe(true);
    }
  });

  it('rejects a single-digit misread', () => {
    expect(isValidGtin('0010000000017')).toBe(false); // check digit bumped
    expect(isValidGtin('0010000090016')).toBe(false); // data digit changed
    expect(isValidGtin('0010000000024')).toBe(false);
  });

  it('accepts UPC-A (12) and EAN-8 and GTIN-14 shapes', () => {
    expect(isValidGtin('036000291452')).toBe(true); // classic UPC-A vector
    expect(isValidGtin('96385074')).toBe(true); // EAN-8 vector
    expect(isValidGtin('00010000000016')).toBe(true); // GTIN-14 (leading 0 pads an EAN-13)
  });

  it('rejects non-GTIN lengths and non-numeric codes', () => {
    expect(isValidGtin('SUPP000010')).toBe(false); // supplier identcode — not a barcode
    expect(isValidGtin('001000000001')).toBe(false); // 12 digits but bad check (not a UPC)
    expect(isValidGtin('')).toBe(false);
    expect(isGtinShaped('12345')).toBe(false);
  });

  it('normalizes spaces and dashes before validating', () => {
    expect(normalizeBarcode('0010 0000 0001 6')).toBe('0010000000016');
    expect(isValidGtin('0010-0000-0001-6')).toBe(true);
  });

  it('computes the check digit for the sample invoice's first line', () => {
    expect(gtinCheckDigit('001000000001')).toBe(6);
  });
});
