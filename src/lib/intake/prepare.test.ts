import { describe, expect, it } from 'vitest';
import { isOversized, MAX_UPLOAD_BYTES, planHashDedupe } from './prepare';

describe('isOversized (Phase 36 upload preparation)', () => {
  it('passes small portal PDFs and fails photographed paperwork sizes', () => {
    expect(isOversized(89_000)).toBe(false); // Mainchain portal invoice
    expect(isOversized(4_694_500)).toBe(true); // photographed delivery note
    expect(isOversized(24_281_000)).toBe(true); // photographed PO printout
    expect(isOversized(MAX_UPLOAD_BYTES)).toBe(false);
    expect(isOversized(MAX_UPLOAD_BYTES + 1)).toBe(true);
  });
});

describe('planHashDedupe', () => {
  it('drops a byte-identical file whatever its name — the duplicate invoice case', () => {
    const plan = planHashDedupe([
      { name: 'Mainchain20261120_160258.PDF', hash: 'aaa' },
      { name: 'invoice.PDF', hash: 'bbb' },
      { name: 'Mainchain20261120_160311.PDF', hash: 'aaa' },
    ]);
    expect(plan.keep).toEqual([0, 1]);
    expect(plan.duplicates).toEqual([
      { name: 'Mainchain20261120_160311.PDF', duplicateOf: 'Mainchain20261120_160258.PDF' },
    ]);
  });

  it('keeps everything when all hashes differ', () => {
    const plan = planHashDedupe([
      { name: 'a.pdf', hash: '1' },
      { name: 'b.pdf', hash: '2' },
    ]);
    expect(plan.keep).toEqual([0, 1]);
    expect(plan.duplicates).toEqual([]);
  });
});
