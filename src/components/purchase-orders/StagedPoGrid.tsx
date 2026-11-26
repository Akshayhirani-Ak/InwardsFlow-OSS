'use client';

// Phase 29: review and correct the extracted purchase order before it is
// filed. What is filed becomes a LIVE BALANCE that deliveries draw down,
// so this grid is the one human check — every line editable, junk lines
// removable, and the publish button states what filing means.

import React, { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { AiPurchaseOrderResponse, StagedPoLine } from '@/types/wms';
import { cleanPoNumber } from '@/lib/intake/naming';

export interface UpsertPoPayload {
  po_number: string;
  supplier_name: string;
  order_date: string;
  lines: StagedPoLine[];
}

export interface UpsertPoResult {
  created: boolean;
  po_number: string;
  lines: number;
  linked_consignments?: number;
}

interface StagedPoGridProps {
  initialPo: AiPurchaseOrderResponse | null; // null = manual blank entry
  onPublish: (payload: UpsertPoPayload) => Promise<UpsertPoResult>;
  onFiled: (result: UpsertPoResult) => void;
  onCancel: () => void;
}

const inputCls =
  'w-full px-2 py-1.5 text-[13px] bg-white border border-edge rounded-control focus:outline-none focus:ring-2 focus:ring-accent';

export function StagedPoGrid({ initialPo, onPublish, onFiled, onCancel }: StagedPoGridProps) {
  const [poNumber, setPoNumber] = useState(initialPo?.po_number || '');
  const [supplierName, setSupplierName] = useState(initialPo?.supplier_name || '');
  const [orderDate, setOrderDate] = useState(initialPo?.order_date || '');
  const [lines, setLines] = useState<StagedPoLine[]>(
    initialPo?.lines?.length
      ? initialPo.lines.map((l) => ({ ...l }))
      : [{ product_code: '', supplier_code: '', description: '', uom: 'EA', ordered_qty: 0 }]
  );
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  const cleanedNumber = useMemo(() => cleanPoNumber(poNumber), [poNumber]);
  const usableLines = useMemo(
    () => lines.filter((l) => l.product_code.trim() !== '' && Number(l.ordered_qty) > 0),
    [lines]
  );
  const canPublish = cleanedNumber !== '' && usableLines.length > 0 && !publishing;

  const updateLine = (idx: number, patch: Partial<StagedPoLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));
  const addLine = () =>
    setLines((prev) => [
      ...prev,
      { product_code: '', supplier_code: '', description: '', uom: 'EA', ordered_qty: 0 },
    ]);

  const handlePublish = async () => {
    if (!canPublish) return;
    setPublishing(true);
    setError('');
    try {
      const result = await onPublish({
        po_number: cleanedNumber,
        supplier_name: supplierName.trim(),
        order_date: orderDate,
        lines: usableLines.map((l) => ({
          product_code: l.product_code.trim().toUpperCase(),
          supplier_code: (l.supplier_code || '').trim().toUpperCase(),
          description: l.description.trim(),
          uom: (l.uom || 'EA').trim().toUpperCase() || 'EA',
          ordered_qty: Number(l.ordered_qty),
        })),
      });
      onFiled(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to file the purchase order.');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="bg-surface rounded-card shadow-rest">
      <div className="px-4 py-3 border-b border-line">
        <h2 className="text-[15px] font-semibold text-ink">Check the purchase order</h2>
        <p className="text-xs text-secondary mt-0.5">
          Check every line against the printout before filing — once filed, this is the live balance
          deliveries draw down. A PO already on file is never overwritten.
        </p>
      </div>

      {initialPo?.warnings?.length ? (
        <div className="px-4 py-2.5 border-b border-attention bg-attention text-[13px] text-warning">
          {initialPo.warnings.join(' ')}
        </div>
      ) : null}

      {/* Header fields */}
      <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3 border-b border-line">
        <div>
          <label className="block text-xs font-semibold text-secondary mb-1">PO number *</label>
          <input
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            placeholder="e.g. 1000004"
            className={`${inputCls} font-mono font-semibold`}
          />
          {poNumber.trim() !== '' && cleanedNumber === '' && (
            <p className="text-xs text-danger mt-1">That does not read as a PO number.</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold text-secondary mb-1">Supplier</label>
          <input
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            placeholder="Supplier name"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-secondary mb-1">Order date</label>
          <input
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      {/* Lines */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[720px]">
          <thead>
            <tr className="border-b border-edge text-[11px] uppercase text-secondary">
              <th className="py-2 px-3 font-semibold">Product code *</th>
              <th className="py-2 px-3 font-semibold">Supplier code</th>
              <th className="py-2 px-3 font-semibold">Description</th>
              <th className="py-2 px-3 font-semibold w-20">Unit</th>
              <th className="py-2 px-3 font-semibold text-right w-28">Ordered qty *</th>
              <th className="py-2 px-2 w-10" aria-label="Remove" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((line, idx) => (
              <tr key={idx}>
                <td className="py-1.5 px-3">
                  <input
                    value={line.product_code}
                    onChange={(e) => updateLine(idx, { product_code: e.target.value })}
                    className={`${inputCls} font-mono font-semibold`}
                    placeholder="Product code"
                  />
                </td>
                <td className="py-1.5 px-3">
                  <input
                    value={line.supplier_code || ''}
                    onChange={(e) => updateLine(idx, { supplier_code: e.target.value })}
                    className={`${inputCls} font-mono`}
                    placeholder="—"
                  />
                </td>
                <td className="py-1.5 px-3">
                  <input
                    value={line.description}
                    onChange={(e) => updateLine(idx, { description: e.target.value })}
                    className={inputCls}
                    placeholder="Product description"
                  />
                </td>
                <td className="py-1.5 px-3">
                  <input
                    value={line.uom || 'EA'}
                    onChange={(e) => updateLine(idx, { uom: e.target.value })}
                    className={inputCls}
                  />
                </td>
                <td className="py-1.5 px-3">
                  <input
                    type="number"
                    min={0}
                    value={line.ordered_qty || ''}
                    onChange={(e) => updateLine(idx, { ordered_qty: Number(e.target.value) })}
                    onWheel={(e) => e.currentTarget.blur()}
                    className={`${inputCls} text-right tabular-nums font-semibold`}
                    placeholder="0"
                  />
                </td>
                <td className="py-1.5 px-2">
                  <button
                    type="button"
                    onClick={() => removeLine(idx)}
                    className="p-1.5 text-muted hover:text-danger"
                    aria-label={`Remove line ${idx + 1}`}
                  >
                    <Trash2 className="w-4 h-4" strokeWidth={1.75} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2.5 border-t border-line">
        <button
          type="button"
          onClick={addLine}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          Add a line
        </button>
      </div>

      {error && (
        <div className="px-4 py-2.5 border-t border-line bg-damage text-[13px] text-danger">
          {error}
        </div>
      )}

      <div className="px-4 py-3 border-t border-edge flex items-center justify-between gap-3">
        <span className="text-[13px] text-secondary tabular-nums">
          <strong className="text-ink font-semibold">{usableLines.length}</strong> lines ·{' '}
          <strong className="text-ink font-semibold">
            {usableLines.reduce((a, l) => a + Number(l.ordered_qty || 0), 0).toLocaleString('en-NZ')}
          </strong>{' '}
          units ordered
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={publishing}
            className="px-3 py-2 text-[13px] font-semibold border border-edge rounded-control text-ink hover:bg-soft disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handlePublish}
            disabled={!canPublish}
            className="px-4 py-2 text-[13px] font-semibold rounded-control bg-accent text-white hover:bg-pressed disabled:opacity-40 min-h-[40px]"
          >
            {publishing ? 'Filing…' : `File PO ${cleanedNumber || ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
