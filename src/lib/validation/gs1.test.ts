import { describe, expect, it } from 'vitest';
import { gtin14ToEan13, parseGs1 } from './gs1';
import { gtinCheckDigit } from './gtin';

// Fixtures are sample outer-carton labels in the shape of real
// supplier labels. On every label the (02) GTIN-14 is indicator 0 +
// the printed SINGLE PACK EAN, and (37) is the pack size.

describe('parseGs1 — parenthesised form', () => {
  it('Sample batten 20-pack', () => {
    expect(parseGs1('(02)00010000000177(37)000020')).toEqual({
      gtin: '00010000000177',
      count: 20,
    });
  });

  it('tolerates the spaces of the printed human-readable line', () => {
    expect(parseGs1('(02) 0 0010000 00017 7 (37) 000020')).toEqual({
      gtin: '00010000000177',
      count: 20,
    });
  });

  it('Sample wide batten 6-pack', () => {
    expect(parseGs1('(02) 0 0010000 00020 7 (37) 000006')).toEqual({
      gtin: '00010000000207',
      count: 6,
    });
  });
});

describe('parseGs1 — raw scanner form', () => {
  it('Sample lamp A 10-pack, AIs concatenated without separators', () => {
    expect(parseGs1('020001000000018437000010')).toEqual({
      gtin: '00010000000184',
      count: 10,
    });
  });

  it('Sample lamp B 10-pack', () => {
    expect(parseGs1('(02)00010000000191(37)000010')).toEqual({
      gtin: '00010000000191',
      count: 10,
    });
  });

  it('strips a ]C1 symbology prefix and steps over FNC1 separators', () => {
    expect(parseGs1(']C10200010000000177' + '\u001D' + '37000020')).toEqual({
      gtin: '00010000000177',
      count: 20,
    });
  });

  it('reads AI (01) as well as (02)', () => {
    expect(parseGs1('0100010000000177')).toEqual({ gtin: '00010000000177' });
  });

  it('rejects a GTIN whose check digit is wrong', () => {
    expect(parseGs1('(02)00010000000178(37)000020')).toEqual({ count: 20 });
  });

  it('leaves plain codes and junk alone', () => {
    expect(parseGs1('0010000000177')).toEqual({});
    expect(parseGs1('DEMO150')).toEqual({});
    expect(parseGs1('')).toEqual({});
    expect(parseGs1('12345678901234567890')).toEqual({});
  });
});

describe('gtin14ToEan13', () => {
  it('indicator 0 returns exactly the single-pack EAN from the labels', () => {
    expect(gtin14ToEan13('00010000000177')).toBe('0010000000177');
    expect(gtin14ToEan13('00010000000184')).toBe('0010000000184');
    expect(gtin14ToEan13('00010000000191')).toBe('0010000000191');
    expect(gtin14ToEan13('00010000000207')).toBe('0010000000207');
  });

  it('a non-zero indicator converts with a recomputed check digit', () => {
    const data = '1' + '001000000017'; // indicator 1 + the sample's 12 data digits
    const gtin14 = data + String(gtinCheckDigit(data));
    expect(gtin14ToEan13(gtin14)).toBe('0010000000177');
  });

  it('rejects non-GTIN-14 input', () => {
    expect(gtin14ToEan13('0010000000177')).toBeNull(); // EAN-13, not 14
    expect(gtin14ToEan13('00010000000178')).toBeNull(); // bad check digit
    expect(gtin14ToEan13('DEMO150')).toBeNull();
  });
});
