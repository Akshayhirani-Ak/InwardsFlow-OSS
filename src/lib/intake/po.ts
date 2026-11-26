// InwardsFlow — Phase 29 purchase-order salvage (pure, unit-tested).
//
// The company PO is the second document kind the intake reads. Salvage
// follows the manifest pattern (Phase 13): the header is normalized
// leniently, lines validate one by one, unreadable lines are dropped
// and REPORTED with their position and reason. Two PO-specific rules:
//   * the PO number must survive cleanPoNumber to be USED — a PO filed
//     under a wrong number is worse than no PO. Phase 36: a junk or
//     missing number no longer fails the whole extraction when lines
//     survive — a photographed multi-page PO carries its number on the
//     first page only, and continuation pages must still stage their
//     lines. The extraction then carries po_number '' and the staged
//     grid requires a human to supply the number before anything is
//     filed (the grid validates it with the same cleanPoNumber);
//   * a line with no product code or a zero/unreadable order quantity
//     is dropped — the balance it would create is meaningless.
// The order date survives only as a real ISO calendar date; the
// printout's "Received" column is never part of the extraction shape.

import type { z } from 'zod';
import {
  PoLineSchema,
  PurchaseOrderExtractionSchema,
} from '@/lib/validators/zero-currency-schema';
import { cleanPoNumber } from './naming';

type PurchaseOrderExtraction = z.infer<typeof PurchaseOrderExtractionSchema>;

export interface PoDroppedLine {
  line: number; // 1-based position in the extracted lines array
  code: string;
  reason: string;
}

export interface PoSalvageResult {
  po: PurchaseOrderExtraction | null;
  dropped: PoDroppedLine[];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function cleanOrderDate(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const v = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  // Reject rollovers like 2026-02-31 (Date silently becomes March).
  return d.toISOString().slice(0, 10) === v ? v : '';
}

export function salvagePurchaseOrder(parsed: unknown): PoSalvageResult {
  const root = asRecord(parsed);
  const poNumber = cleanPoNumber(root.po_number);
  const rawLines = Array.isArray(root.lines) ? root.lines : [];

  const lines: PurchaseOrderExtraction['lines'] = [];
  const dropped: PoDroppedLine[] = [];
  rawLines.forEach((rawLine, idx) => {
    const rec = asRecord(rawLine);
    const line: Record<string, unknown> = { ...rec };
    // Same near-integer repair as manifest quantities: 504.000001 is 504.
    const qty = Number(line.ordered_qty);
    if (Number.isFinite(qty) && Math.abs(qty - Math.round(qty)) <= 0.01) {
      line.ordered_qty = Math.round(qty);
    }
    const code = typeof rec.product_code === 'string' ? rec.product_code : '';
    const result = PoLineSchema.safeParse(line);
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue?.path?.length ? issue.path.join('.') : '';
      dropped.push({
        line: idx + 1,
        code,
        reason: issue ? `${field ? `${field}: ` : ''}${issue.message}` : 'Unreadable line',
      });
      return;
    }
    if (result.data.ordered_qty <= 0) {
      dropped.push({ line: idx + 1, code, reason: 'Order quantity is zero' });
      return;
    }
    lines.push({
      ...result.data,
      product_code: result.data.product_code.trim().toUpperCase(),
      supplier_code: (result.data.supplier_code || '').trim().toUpperCase(),
      uom: (result.data.uom || 'EA').trim().toUpperCase() || 'EA',
    });
  });

  if (lines.length === 0) {
    return { po: null, dropped };
  }
  return {
    po: {
      po_number: poNumber,
      supplier_name: typeof root.supplier_name === 'string' ? root.supplier_name.trim() : '',
      order_date: cleanOrderDate(root.order_date),
      lines,
    },
    dropped,
  };
}
