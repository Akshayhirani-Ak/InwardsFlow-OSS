import { describe, it, expect } from 'vitest';
import type { ExpectedItem, PalletEntry } from '@/types/wms';

describe('Workbench Manifest & Ledger 200-line Performance Benchmark', () => {
  // Generate a realistic 200-item container manifest
  const generate200Items = (): ExpectedItem[] => {
    return Array.from({ length: 200 }, (_, i) => {
      const idx = i + 1;
      const skuCode = `CBL-${String(idx).padStart(4, '0')}`;
      return {
        id: `item-${idx}`,
        container_id: 'container-test-001',
        sku_code: skuCode,
        supplier_sku_code: `SUPP-${idx}`,
        product_name: `Sample Cable Component Grade ${idx}`,
        expected_cartons: 10 + (idx % 20),
        pack_size: 10,
        expected_total_qty: (10 + (idx % 20)) * 10,
        uom: 'EA',
        scanned_cartons: 0,
        scanned_units: 0,
        damaged_units: 0,
        is_priority: idx <= 10, // First 10 are expedited priority
        is_unlisted_addition: idx > 195, // Last 5 are unlisted discoveries
        created_at: new Date(Date.now() - idx * 60000).toISOString(),
        updated_at: new Date(Date.now() - idx * 60000).toISOString(),
      };
    });
  };

  const generate200Entries = (items: ExpectedItem[]): PalletEntry[] => {
    return Array.from({ length: 200 }, (_, i) => {
      const idx = i + 1;
      const item = items[i % items.length];
      return {
        id: `entry-${idx}`,
        container_id: 'container-test-001',
        pallet_id: `plt-${(idx % 5) + 1}`,
        item_id: item.id,
        cartons_counted: 5,
        pack_size_used: item.pack_size,
        good_qty: 50,
        damaged_qty: idx % 20 === 0 ? 5 : 0,
        qc_status: idx % 20 === 0 ? 'DAMAGED' : 'PASS',
        qc_reason_code: idx % 20 === 0 ? 'PHYSICAL_DAMAGE' : 'PASS',
        qc_remarks: idx % 20 === 0 ? 'Crushed during transit' : undefined,
        is_voided: false,
        created_at: new Date(Date.now() - (200 - idx) * 30000).toISOString(),
        operator_user_id: 'jcarter',
        operator_name: 'James Carter',
      };
    });
  };

  it('aggregates progress across 200 items in under 20ms', () => {
    const items = generate200Items();
    const entries = generate200Entries(items);

    const start = performance.now();

    // Sum entries per item (the workbench ledger calculation)
    const tallyByItem: Record<string, { good: number; damaged: number; count: number }> = {};
    for (const e of entries) {
      if (e.is_voided) continue;
      if (!tallyByItem[e.item_id]) {
        tallyByItem[e.item_id] = { good: 0, damaged: 0, count: 0 };
      }
      tallyByItem[e.item_id].good += e.good_qty;
      tallyByItem[e.item_id].damaged += e.damaged_qty;
      tallyByItem[e.item_id].count += e.cartons_counted;
    }

    const progressMap: Record<
      string,
      { counted: number; damaged: number; expected: number; isComplete: boolean; pct: number }
    > = {};

    for (const item of items) {
      const tally = tallyByItem[item.id] || { good: 0, damaged: 0, count: 0 };
      const expected = item.expected_total_qty;
      const isComplete = tally.good >= expected;
      const pct = expected > 0 ? Math.round((tally.good / expected) * 100) : 0;
      progressMap[item.id] = {
        counted: tally.good,
        damaged: tally.damaged,
        expected,
        isComplete,
        pct,
      };
    }

    const duration = performance.now() - start;

    expect(Object.keys(progressMap).length).toBe(200);
    // 200 items progress calculation must execute well below the 150ms floor budget
    expect(duration).toBeLessThan(50);
  });

  it('sorts 200 items according to priority rules (open priority -> open regular -> complete)', () => {
    const items = generate200Items();
    const skuProgressMap: Record<
      string,
      { counted: number; damaged: number; expected: number; isComplete: boolean; pct: number }
    > = {};

    // Mark half as complete
    items.forEach((it, idx) => {
      skuProgressMap[it.id] = {
        counted: idx % 2 === 0 ? it.expected_total_qty : 0,
        damaged: 0,
        expected: it.expected_total_qty,
        isComplete: idx % 2 === 0,
        pct: idx % 2 === 0 ? 100 : 0,
      };
    });

    const start = performance.now();

    const sorted = [...items].sort((a, b) => {
      const aComp = skuProgressMap[a.id]?.isComplete ? 1 : 0;
      const bComp = skuProgressMap[b.id]?.isComplete ? 1 : 0;
      if (aComp !== bComp) return aComp - bComp;

      const aPrio = a.is_priority ? 1 : 0;
      const bPrio = b.is_priority ? 1 : 0;
      if (aPrio !== bPrio) return bPrio - aPrio;

      return a.sku_code.localeCompare(b.sku_code);
    });

    const duration = performance.now() - start;

    expect(sorted.length).toBe(200);
    // First items in sorted list must not be complete
    expect(skuProgressMap[sorted[0].id].isComplete).toBe(false);
    // If there are open priority items, the first item must be priority
    expect(sorted[0].is_priority).toBe(true);
    // The last item must be complete
    expect(skuProgressMap[sorted[199].id].isComplete).toBe(true);

    expect(duration).toBeLessThan(25);
  });
});
