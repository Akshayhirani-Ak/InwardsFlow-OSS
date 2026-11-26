import { describe, expect, it } from 'vitest';
import { salvagePurchaseOrder } from './po';

const GOOD = {
  po_number: '1000004',
  supplier_name: 'Sample Supplier GmbH',
  order_date: '2026-08-21',
  lines: [
    {
      product_code: 'DEMO001',
      supplier_code: 'SUPP000001',
      description: 'SAMPLE PRO WATERPROOF WIDE BATTEN',
      uom: 'EA',
      ordered_qty: 504,
    },
    {
      product_code: 'DEMO150',
      supplier_code: '6000001',
      description: 'ALUMINIUM FLEXIBLE DUCT 150MM',
      uom: 'EA',
      ordered_qty: 3200,
    },
  ],
};

describe('salvagePurchaseOrder', () => {
  it('stages a clean PO and uppercases codes', () => {
    const { po, dropped } = salvagePurchaseOrder(GOOD);
    expect(dropped).toEqual([]);
    expect(po?.po_number).toBe('1000004');
    expect(po?.supplier_name).toBe('Sample Supplier GmbH');
    expect(po?.order_date).toBe('2026-08-21');
    expect(po?.lines).toHaveLength(2);
    expect(po?.lines[0].product_code).toBe('DEMO001');
  });

  it('cleans a spaced PO number the way naming does', () => {
    const { po } = salvagePurchaseOrder({ ...GOOD, po_number: ' 1000 004 ' });
    expect(po?.po_number).toBe('1000004');
  });

  it('stages lines under a blank number on a junk PO number — the grid demands a human number before filing (Phase 36)', () => {
    const { po } = salvagePurchaseOrder({ ...GOOD, po_number: 'PO' });
    expect(po).not.toBeNull();
    expect(po?.po_number).toBe('');
    expect(po?.lines).toHaveLength(2);
  });

  it('still fails the whole extraction when no line survives, whatever the number', () => {
    const { po } = salvagePurchaseOrder({ ...GOOD, po_number: 'PO', lines: [] });
    expect(po).toBeNull();
  });

  it('drops a line with no product code and reports it by position', () => {
    const { po, dropped } = salvagePurchaseOrder({
      ...GOOD,
      lines: [GOOD.lines[0], { product_code: '', ordered_qty: 10 }, GOOD.lines[1]],
    });
    expect(po?.lines).toHaveLength(2);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].line).toBe(2);
  });

  it('drops a zero-quantity line — it would create a meaningless balance', () => {
    const { po, dropped } = salvagePurchaseOrder({
      ...GOOD,
      lines: [{ product_code: 'X12345', ordered_qty: 0 }],
    });
    expect(po).toBeNull();
    expect(dropped[0].reason).toMatch(/zero/i);
  });

  it('repairs near-integer quantities (504.000001 is 504)', () => {
    const { po } = salvagePurchaseOrder({
      ...GOOD,
      lines: [{ product_code: 'X12345', ordered_qty: 504.000001 }],
    });
    expect(po?.lines[0].ordered_qty).toBe(504);
  });

  it('drops a fractional quantity it cannot repair', () => {
    const { po, dropped } = salvagePurchaseOrder({
      ...GOOD,
      lines: [{ product_code: 'X12345', ordered_qty: 10.5 }],
    });
    expect(po).toBeNull();
    expect(dropped).toHaveLength(1);
  });

  it('rejects impossible order dates but keeps the PO', () => {
    const { po } = salvagePurchaseOrder({ ...GOOD, order_date: '2026-02-31' });
    expect(po?.order_date).toBe('');
    const { po: po2 } = salvagePurchaseOrder({ ...GOOD, order_date: '21/08/2026' });
    expect(po2?.order_date).toBe('');
  });

  it('fails when no lines survive', () => {
    const { po } = salvagePurchaseOrder({ ...GOOD, lines: [] });
    expect(po).toBeNull();
  });
});
