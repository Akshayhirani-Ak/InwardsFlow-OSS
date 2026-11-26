import { describe, it, expect } from 'vitest';
import {
  normalizeContainerNumber,
  isIso6346Shaped,
  isValidIso6346,
  iso6346CheckDigit,
  containerNumberIssue,
} from './iso6346';

// Vectors cross-checked against the SQL twin (public.iso6346_valid,
// migration 0005) on a real Postgres — client and server must never drift.
describe('iso6346', () => {
  it('normalizes case and strips separators', () => {
    expect(normalizeContainerNumber('mscu-902184-7')).toBe('MSCU9021847');
    expect(normalizeContainerNumber(' CSQU 305438 3 ')).toBe('CSQU3054383');
  });

  it('recognizes the ISO shape (4 letters + 7 digits)', () => {
    expect(isIso6346Shaped('CSQU3054383')).toBe(true);
    expect(isIso6346Shaped('CONT-1234')).toBe(false);
    expect(isIso6346Shaped('TESTCNT0001')).toBe(false); // 7 letters + 4 digits is not ISO
  });

  it('verifies known-valid numbers', () => {
    expect(isValidIso6346('CSQU3054383')).toBe(true);
    expect(isValidIso6346('MSKU6011672')).toBe(true);
  });

  it('rejects wrong check digits', () => {
    expect(isValidIso6346('CSQU3054380')).toBe(false);
    expect(isValidIso6346('MSCU9021847')).toBe(false);
    expect(isValidIso6346('TCLU1234567')).toBe(false);
  });

  it('computes the check digit of the first ten characters', () => {
    expect(iso6346CheckDigit('CSQU305438')).toBe(3);
    expect(iso6346CheckDigit('MSKU601167')).toBe(2);
  });

  it('blocks only ISO-shaped CONTAINER arrivals with bad digits', () => {
    expect(containerNumberIssue('CSQU3054380', 'CONTAINER')).toMatch(/check digit/);
    expect(containerNumberIssue('CSQU3054383', 'CONTAINER')).toBeNull();
    expect(containerNumberIssue('CSQU3054380', 'COURIER_PARCEL')).toBeNull();
    expect(containerNumberIssue('CONT-1234', 'CONTAINER')).toBeNull();
    expect(containerNumberIssue('', 'CONTAINER')).toBeNull();
  });
});
