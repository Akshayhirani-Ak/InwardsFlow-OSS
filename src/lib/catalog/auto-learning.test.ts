import { describe, it, expect } from 'vitest';
import { calculateBoxBreakdown } from './auto-learning';

describe('calculateBoxBreakdown', () => {
  it('handles zero and negative quantities', () => {
    expect(calculateBoxBreakdown(0, 100).totalBoxes).toBe(0);
    expect(calculateBoxBreakdown(-5, 100).formattedSummary).toBe('0 Boxes');
  });

  it('splits full boxes plus a partial (950 @ 100/box)', () => {
    const b = calculateBoxBreakdown(950, 100);
    expect(b.fullBoxes).toBe(9);
    expect(b.partialBoxes).toBe(1);
    expect(b.partialPcs).toBe(50);
    expect(b.totalBoxes).toBe(10);
    expect(b.formattedSummary).toContain('10 Physical Boxes');
  });

  it('reports exact multiples as full boxes only', () => {
    const b = calculateBoxBreakdown(1000, 100);
    expect(b.fullBoxes).toBe(10);
    expect(b.partialBoxes).toBe(0);
    expect(b.totalBoxes).toBe(10);
  });

  it('treats pack size 1 as loose units', () => {
    const b = calculateBoxBreakdown(37, 1);
    expect(b.fullBoxes).toBe(37);
    expect(b.totalBoxes).toBe(37);
    expect(b.formattedSummary).toContain('Loose');
  });

  it('falls back to pack size 1 for a non-positive pack size', () => {
    const b = calculateBoxBreakdown(12, 0);
    expect(b.totalBoxes).toBe(12);
  });
});
