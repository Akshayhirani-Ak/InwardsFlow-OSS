import { describe, expect, it } from 'vitest';
import type { PurchaseOrderDetail, PurchaseOrderLine } from '@/types/wms';
import {
  buildPoCountingItems,
  buildPoCountingPayload,
  owedLines,
} from './start-counting';

function line(partial: Partial<PurchaseOrderLine>): PurchaseOrderLine {
  return {
    id: 'line-1',
    line_index: 1,
    product_code: 'OSRO000001',
    supplier_code: 'AC000001',
    description: 'Test lamp',
    uom: 'EA',
    ordered_qty: 100,
    received_qty: 0,
    remaining_qty: 100,
    closed_at: null,
    closed_reason: null,
    closed_by_name: null,
    receipts: [],
    ...partial,
  };
}

function po(lines: PurchaseOrderLine[]): PurchaseOrderDetail {
  return {
    id: 'po-1',
    po_number: '1000005',
    supplier_name: 'Sample Supplier Pty Limited',
    order_date: '2026-09-10',
    status: 'OPEN',
    closed_reason: null,
    closed_at: null,
    notes: null,
    created_by_name: 'Master',
    created_at: '2026-09-10T00:00:00Z',
    lines,
    deliveries: [],
  };
}

describe('owedLines', () => {
  it('keeps only open lines with a balance still owed', () => {
    const detail = po([
      line({ id: 'a', remaining_qty: 40 }),
      line({ id: 'b', remaining_qty: 0, received_qty: 100 }),
      line({ id: 'c', remaining_qty: 25, closed_at: '2026-10-01T00:00:00Z' }),
    ]);
    expect(owedLines(detail).map((l) => l.id)).toEqual(['a']);
  });
});

describe('buildPoCountingItems', () => {
  it('expects exactly the remaining quantity, split by the learned pack size', () => {
    const detail = po([line({ remaining_qty: 95 })]);
    const items = buildPoCountingItems(detail, new Map([['OSRO000001', 10]]));
    expect(items).toHaveLength(1);
    expect(items[0].expected_cartons).toBe(9);
    expect(items[0].pack_size).toBe(10);
    expect(items[0].expected_partial_qty).toBe(5);
    expect(items[0].partial_cartons).toBe(1);
    // The staged total the counting screen will show:
    expect(items[0].expected_cartons * items[0].pack_size + items[0].expected_partial_qty).toBe(95);
  });

  it('falls back to cartons of one when no pack size is known', () => {
    const detail = po([line({ remaining_qty: 37 })]);
    const items = buildPoCountingItems(detail, new Map());
    expect(items[0].pack_size).toBe(1);
    expect(items[0].expected_cartons).toBe(37);
    expect(items[0].expected_partial_qty).toBe(0);
    expect(items[0].partial_cartons).toBe(0);
  });

  it('stages a whole line as one partial when the balance is under one pack', () => {
    const detail = po([line({ remaining_qty: 6 })]);
    const items = buildPoCountingItems(detail, new Map([['OSRO000001', 10]]));
    expect(items[0].expected_cartons).toBe(0);
    expect(items[0].expected_partial_qty).toBe(6);
    expect(items[0].partial_cartons).toBe(1);
  });

  it('carries the PO line identity: product code, supplier code, description, uom', () => {
    const detail = po([
      line({ product_code: 'OSL123', supplier_code: 'AC999', description: 'Batten 20W', uom: 'EA' }),
    ]);
    const items = buildPoCountingItems(detail, new Map());
    expect(items[0].sku_code).toBe('OSL123');
    expect(items[0].supplier_code).toBe('AC999');
    expect(items[0].product_name).toBe('Batten 20W');
    expect(items[0].uom).toBe('EA');
  });
});

describe('buildPoCountingPayload', () => {
  it('files the session under the PO number so finalise draws the PO down', () => {
    const detail = po([line({})]);
    const payload = buildPoCountingPayload(detail, new Map(), 2);
    expect(payload.consignment_ref).toBe('1000005');
    expect(payload.po_numbers).toEqual(['1000005']);
    expect(payload.supplier_name).toBe('Sample Supplier Pty Limited');
    expect(payload.containers).toHaveLength(1);
    expect(payload.containers[0].container_number).toBe('PO-1000005-2');
    expect(payload.containers[0].document_ref).toBe('1000005');
    expect(payload.containers[0].items).toHaveLength(1);
  });

  it('is not a container arrival, so no ISO check-digit gate applies', () => {
    const payload = buildPoCountingPayload(po([line({})]), new Map(), 1);
    expect(payload.arrival_type).toBe('PALLET_FREIGHT');
    expect(payload.containers[0].container_size).toBe('LCL');
  });
});
