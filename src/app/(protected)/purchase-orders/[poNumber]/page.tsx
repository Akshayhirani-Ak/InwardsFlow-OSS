'use client';

export const dynamic = 'force-dynamic';

// Phase 29: one purchase order, whole story — every line's balance
// (ordered / received / still owed), where the received units landed,
// and every delivery filed under the number. This is the screen that
// answers "what remains?" when the next delivery for this PO arrives.

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ClipboardList } from 'lucide-react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthPermissionContext';
import type { PurchaseOrderDetail, PurchaseOrderLine } from '@/types/wms';
import { thrownMessage, formatPoRpcError } from '@/lib/intake/pending';

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
}

function lineStatus(line: PurchaseOrderLine): { word: string; cls: string } {
  if (line.closed_at) return { word: 'Short-closed', cls: 'text-warning' };
  if (line.received_qty >= line.ordered_qty) return { word: 'Complete', cls: 'text-positive' };
  if (line.received_qty > 0)
    return { word: `−${line.remaining_qty.toLocaleString('en-NZ')} to go`, cls: 'text-warning' };
  return { word: 'Not started', cls: 'text-muted' };
}

export default function PurchaseOrderDetailPage({
  params,
}: {
  params: { poNumber: string };
}) {
  const poNumber = decodeURIComponent(params.poNumber);
  const supabase = createBrowserSupabaseClient();
  const { isMaster, hasPermission } = useAuth();
  // Same gate the publish RPC enforces server-side.
  const canStartCounting = isMaster || hasPermission('ai_intake');

  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  // Short-close inline form state (one line at a time).
  const [closingLineId, setClosingLineId] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('get_purchase_order', {
      p_po_number: poNumber,
    });
    if (rpcError) {
      setPo(null);
      setError(formatPoRpcError(rpcError, rpcError.message));
    } else if (!data) {
      setPo(null);
      setNotFound(true);
    } else {
      setError('');
      setPo(data as unknown as PurchaseOrderDetail);
    }
    setLoading(false);
  }, [supabase, poNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleShortClose = async (line: PurchaseOrderLine) => {
    if (!closeReason.trim()) return;
    setActionBusy(true);
    setActionError('');
    const { error: rpcError } = await supabase.rpc('short_close_po_line', {
      p_line_id: line.id,
      p_reason: closeReason.trim(),
    });
    setActionBusy(false);
    if (rpcError) {
      setActionError(thrownMessage(rpcError, rpcError.message));
      return;
    }
    setClosingLineId(null);
    setCloseReason('');
    void load();
  };

  const handleReopenLine = async (line: PurchaseOrderLine) => {
    setActionBusy(true);
    setActionError('');
    const { error: rpcError } = await supabase.rpc('reopen_po_line', { p_line_id: line.id });
    setActionBusy(false);
    if (rpcError) {
      setActionError(thrownMessage(rpcError, rpcError.message));
      return;
    }
    void load();
  };

  if (loading) {
    return (
      <div className="flex-1 max-w-6xl w-full mx-auto p-6">
        <p className="text-sm text-muted">Loading PO {poNumber}…</p>
      </div>
    );
  }

  if (error) {
    return <div role="alert" className="p-4 text-sm text-danger">{error} <button className="min-h-[48px] underline" onClick={() => void load()}>Retry</button></div>;
  }

  if (notFound || !po) {
    return (
      <div className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-4">
        <Link href="/purchase-orders" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline">
          <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.75} /> All purchase orders
        </Link>
        <div className="bg-surface rounded-card shadow-rest px-4 py-8 text-center">
          <p className="text-sm text-ink">
            PO <span className="font-mono font-semibold">{poNumber}</span> is not on file.
          </p>
          <p className="text-[13px] text-muted mt-1">
            {error || 'Upload its printout from the Purchase Orders screen — one upload, then it lives here.'}
          </p>
        </div>
      </div>
    );
  }

  const orderedTotal = po.lines.reduce((a, l) => a + l.ordered_qty, 0);
  const receivedTotal = po.lines.reduce((a, l) => a + l.received_qty, 0);
  const remainingTotal = po.lines.reduce((a, l) => a + l.remaining_qty, 0);
  const closed = po.status === 'CLOSED';

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-6">
      <Link href="/purchase-orders" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline">
        <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.75} /> All purchase orders
      </Link>

      {/* Header */}
      <div className="bg-surface rounded-card shadow-rest p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-mono font-bold text-2xl text-ink break-all">{po.po_number}</h1>
          <span className={`text-sm font-bold ${closed ? 'text-positive' : 'text-accent'}`}>
            {closed ? 'COMPLETE' : 'OPEN'}
          </span>
        </div>
        <p className="text-[13px] text-secondary mt-0.5">
          {po.supplier_name || 'Supplier not stated'}
          {po.order_date ? ` · ordered ${fmtDate(po.order_date)}` : ''}
          {po.created_by_name ? ` · filed by ${po.created_by_name}` : ''}
          {closed && po.closed_at ? ` · completed ${fmtDate(po.closed_at)}` : ''}
        </p>
        <p className="text-sm text-secondary tabular-nums mt-2">
          <strong className="text-ink font-semibold">{orderedTotal.toLocaleString('en-NZ')}</strong> ordered
          {' · '}
          <strong className="text-ink font-semibold">{receivedTotal.toLocaleString('en-NZ')}</strong> received
          {' · '}
          {remainingTotal > 0 ? (
            <strong className="font-semibold text-warning">
              {remainingTotal.toLocaleString('en-NZ')} still owed
            </strong>
          ) : (
            <strong className="font-semibold text-positive">nothing owed</strong>
          )}
        </p>
        {!closed && remainingTotal > 0 && canStartCounting && (
          <div className="mt-3">
            <Link href="/intake" className="inline-flex min-h-[48px] items-center gap-2 rounded-control bg-accent px-4 text-sm font-semibold text-white">
              <ClipboardList className="h-4 w-4" /> Start counting a delivery
            </Link>
            <p className="text-[12px] text-muted mt-1.5">Use the supplier packing list for this delivery.</p>
          </div>
        )}
      </div>

      {actionError && (
        <div className="px-4 py-2.5 bg-damage border border-damage text-[13px] text-danger">
          {actionError}
        </div>
      )}

      {/* Lines */}
      <div className="bg-surface rounded-card shadow-rest overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[760px]">
          <thead>
            <tr className="border-b border-edge text-[11px] uppercase text-secondary">
              <th className="py-2 px-3 font-semibold">Product code</th>
              <th className="py-2 px-3 font-semibold">Description</th>
              <th className="py-2 px-3 font-semibold text-right">Ordered</th>
              <th className="py-2 px-3 font-semibold text-right">Received</th>
              <th className="py-2 px-3 font-semibold text-right">Still owed</th>
              <th className="py-2 px-3 font-semibold">Status</th>
              {isMaster && <th className="py-2 px-3 w-28" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {po.lines.map((line) => {
              const status = lineStatus(line);
              return (
                <React.Fragment key={line.id}>
                  <tr className={line.closed_at ? 'opacity-70' : undefined}>
                    <td className="py-2 px-3 align-top">
                      <span className="font-mono font-semibold text-[13px] text-ink break-all">
                        {line.product_code}
                      </span>
                      {line.supplier_code && (
                        <span className="block font-mono text-[11px] text-muted">
                          supplier {line.supplier_code}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 align-top text-[13px] text-secondary">
                      {line.description || '—'}
                      {line.receipts.length > 0 && (
                        <span className="block text-[11px] text-muted mt-0.5">
                          {line.receipts
                            .map((r) => `${r.qty.toLocaleString('en-NZ')} in ${r.container_number}`)
                            .join(' · ')}
                        </span>
                      )}
                      {line.closed_at && (
                        <span className="block text-[11px] text-warning mt-0.5">
                          {line.closed_reason}
                          {line.closed_by_name ? ` — ${line.closed_by_name}` : ''}
                          {line.closed_at ? `, ${fmtDate(line.closed_at)}` : ''}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 align-top text-right tabular-nums text-[13px]">
                      {line.ordered_qty.toLocaleString('en-NZ')}
                    </td>
                    <td className="py-2 px-3 align-top text-right tabular-nums text-[13px] font-semibold text-ink">
                      {line.received_qty.toLocaleString('en-NZ')}
                    </td>
                    <td className="py-2 px-3 align-top text-right tabular-nums text-[13px] font-semibold">
                      {line.remaining_qty > 0 ? (
                        <span className="text-warning">{line.remaining_qty.toLocaleString('en-NZ')}</span>
                      ) : (
                        <span className="text-muted">0</span>
                      )}
                    </td>
                    <td className={`py-2 px-3 align-top text-[13px] font-semibold ${status.cls}`}>
                      {status.word}
                    </td>
                    {isMaster && (
                      <td className="py-2 px-3 align-top text-right">
                        {!line.closed_at && line.remaining_qty > 0 ? (
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => {
                              setClosingLineId(closingLineId === line.id ? null : line.id);
                              setCloseReason('');
                              setActionError('');
                            }}
                            className="text-xs font-semibold text-accent hover:underline disabled:opacity-50"
                          >
                            Short-close
                          </button>
                        ) : line.closed_at ? (
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => void handleReopenLine(line)}
                            className="text-xs font-semibold text-accent hover:underline disabled:opacity-50"
                          >
                            Reopen
                          </button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                  {closingLineId === line.id && (
                    <tr>
                      <td colSpan={isMaster ? 7 : 6} className="px-3 py-2.5 bg-attention border-y border-attention">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] text-warning">
                            Short-close <strong>{line.remaining_qty.toLocaleString('en-NZ')}</strong> owed on{' '}
                            <span className="font-mono font-semibold">{line.product_code}</span> — the supplier
                            will not send them. Reason (required, stays on the record):
                          </span>
                          <input
                            value={closeReason}
                            onChange={(e) => setCloseReason(e.target.value)}
                            placeholder="e.g. Supplier confirmed discontinued"
                            className="flex-1 min-w-[220px] px-2 py-1.5 text-[13px] bg-white border border-edge rounded-control focus:outline-none focus:ring-2 focus:ring-accent"
                          />
                          <button
                            type="button"
                            disabled={actionBusy || !closeReason.trim()}
                            onClick={() => void handleShortClose(line)}
                            className="px-3 py-1.5 text-[13px] font-semibold rounded-control bg-accent text-white disabled:opacity-40"
                          >
                            {actionBusy ? 'Closing…' : 'Short-close line'}
                          </button>
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => setClosingLineId(null)}
                            className="px-3 py-1.5 text-[13px] font-semibold border border-edge rounded-control bg-white disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Deliveries filed under this PO */}
      <div className="bg-surface rounded-card shadow-rest">
        <h2 className="px-4 py-2.5 text-[13px] font-semibold text-ink border-b border-line">
          Deliveries against this PO ({po.deliveries.length})
        </h2>
        {po.deliveries.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-muted">
            No delivery has been filed under this PO number yet.
            {canStartCounting && !closed
              ? ' Press “Start counting a delivery” above to count one straight from this PO, or name an intake consignment with this PO number.'
              : ' When one arrives, name its consignment with this PO number and it will appear here.'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {po.deliveries.map((d) => (
              <li key={d.consignment_id} className="px-4 py-2.5">
                <span className="font-mono font-semibold text-[13px] text-ink break-all">
                  {d.consignment_ref}
                </span>
                <ul className="mt-1 space-y-0.5">
                  {d.containers.map((c) => {
                    const beyond = c.status === 'completed' && c.counted_good > c.allocated;
                    return (
                      <li key={c.id} className="text-[13px] text-secondary tabular-nums">
                        <Link
                          href={`/workbench/${c.id}`}
                          className="font-mono text-accent hover:underline"
                        >
                          {c.container_number}
                        </Link>{' '}
                        · {c.status} · counted {c.counted_good.toLocaleString('en-NZ')} · on this PO{' '}
                        {c.allocated.toLocaleString('en-NZ')}
                        {beyond && (
                          <span className="text-warning font-semibold">
                            {' '}
                            · {(c.counted_good - c.allocated).toLocaleString('en-NZ')} counted beyond this PO
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
