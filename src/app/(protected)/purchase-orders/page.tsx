'use client';
import { Banner, ListState } from '@/components/ui/Feedback';

export const dynamic = 'force-dynamic';

// Phase 29: the purchase-order register. Every PO on file with its live
// balance — ordered / received / still owed — searchable by PO number
// (the main ID, per the floor ruling). Upload happens once per PO; the
// register is where the balance lives from then on.

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthPermissionContext';
import type {
  AiPurchaseOrderResponse,
  PurchaseOrderSummary,
} from '@/types/wms';
import { PoUploadPanel } from '@/components/purchase-orders/PoUploadPanel';
import {
  StagedPoGrid,
  UpsertPoPayload,
  UpsertPoResult,
} from '@/components/purchase-orders/StagedPoGrid';
import { formatPoRpcError } from '@/lib/intake/pending';

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const { hasPermission } = useAuth();
  const canIntake = hasPermission('ai_intake');

  const [summaries, setSummaries] = useState<PurchaseOrderSummary[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // null = register view; 'manual' = blank grid; object = extracted PO.
  const [staged, setStaged] = useState<AiPurchaseOrderResponse | 'manual' | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(
    async (term: string) => {
      setLoading(true);
      const { data, error: rpcError } = await supabase.rpc('list_purchase_orders', {
        p_search: term.trim() || null,
      });
      if (rpcError) {
        setError(formatPoRpcError(rpcError, rpcError.message));
        setSummaries([]);
      } else {
        setError('');
        setSummaries((data as unknown as PurchaseOrderSummary[]) || []);
      }
      setLoading(false);
    },
    [supabase]
  );

  useEffect(() => {
    void load(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => void load(search);

  const handlePublish = async (payload: UpsertPoPayload): Promise<UpsertPoResult> => {
    const { data, error: rpcError } = await supabase.rpc('upsert_purchase_order', {
      p_payload: {
        po_number: payload.po_number,
        supplier_name: payload.supplier_name || null,
        order_date: payload.order_date || null,
        lines: payload.lines,
      },
    });
    if (rpcError) throw new Error(formatPoRpcError(rpcError, rpcError.message));
    const r = data as unknown as {
      po_number: string;
      created: boolean;
      lines: number;
      linked_consignments?: number;
    };
    return {
      created: r.created,
      po_number: r.po_number,
      lines: r.lines,
      linked_consignments: r.linked_consignments,
    };
  };

  const handleFiled = (result: UpsertPoResult) => {
    setStaged(null);
    if (result.created) {
      router.push(`/purchase-orders/${encodeURIComponent(result.po_number)}`);
    } else {
      setNotice(
        `PO ${result.po_number} is already on file — its live balance was not touched. A re-printed PO never resets what the floor has counted.`
      );
      void load(search);
    }
  };

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Purchase Orders</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" strokeWidth={1.75} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search PO number or supplier"
              className="pl-8 pr-3 py-2 text-[13px] w-64 bg-white border border-edge rounded-control focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <button
            type="button"
            onClick={handleSearch}
            className="px-3 py-2 text-[13px] font-semibold border border-edge rounded-control bg-white text-ink hover:bg-soft"
          >
            Search
          </button>
        </div>
      </div>

      {notice && (
        <Banner>{notice}</Banner>
      )}

      {canIntake &&
        (staged === null ? (
          <PoUploadPanel
            onExtracted={(po) => {
              setNotice('');
              setStaged(po);
            }}
            onManualEntry={() => {
              setNotice('');
              setStaged('manual');
            }}
          />
        ) : (
          <StagedPoGrid
            initialPo={staged === 'manual' ? null : staged}
            onPublish={handlePublish}
            onFiled={handleFiled}
            onCancel={() => setStaged(null)}
          />
        ))}

      {error && (
        <Banner error>{error}</Banner>
      )}

      <div className="bg-surface rounded-card shadow-rest">
        {loading ? (
          <ListState loading>Loading purchase orders…</ListState>
        ) : summaries.length === 0 ? (
          <ListState>
            {search.trim()
              ? `No purchase order matches “${search.trim()}”.`
              : 'No purchase orders on file yet. Upload the first PO printout above — it only ever needs uploading once.'}
          </ListState>
        ) : (
          <ul className="divide-y divide-line">
            {summaries.map((po) => {
              const closed = po.status === 'CLOSED';
              const started = po.received_total > 0;
              const pct = po.ordered_total > 0 ? Math.min(100, (po.received_total / po.ordered_total) * 100) : 0;
              return (
                <li key={po.id}>
                  <Link
                    href={`/purchase-orders/${encodeURIComponent(po.po_number)}`}
                    className="flex gap-3 px-4 py-3 hover:bg-soft min-h-[64px]"
                  >
                    <span
                      className={`w-1 shrink-0 ${
                        closed ? 'bg-positive' : started ? 'bg-accent' : 'bg-transparent'
                      }`}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="font-mono font-semibold text-[15px] text-ink break-all">
                          {po.po_number}
                        </span>
                        <span className="text-[13px] tabular-nums whitespace-nowrap">
                          <strong className="font-semibold text-ink">
                            {po.received_total.toLocaleString('en-NZ')}
                          </strong>{' '}
                          <span className="text-muted">
                            / {po.ordered_total.toLocaleString('en-NZ')} pcs
                          </span>
                        </span>
                      </span>
                      <span className="block text-[13px] text-secondary truncate">
                        {po.supplier_name || 'Supplier not stated'}
                        {po.order_date ? ` · ordered ${fmtDate(po.order_date)}` : ''}
                      </span>
                      <span className="block text-xs text-muted tabular-nums mt-0.5">
                        {po.lines_total} lines · {po.deliveries}{' '}
                        {po.deliveries === 1 ? 'delivery' : 'deliveries'}
                        {closed ? (
                          <span className="text-positive font-semibold"> · COMPLETE</span>
                        ) : po.remaining_total > 0 ? (
                          <span className="text-warning font-semibold">
                            {' '}
                            · {po.remaining_total.toLocaleString('en-NZ')} still owed
                          </span>
                        ) : null}
                      </span>
                      <span className="block h-[3px] bg-soft mt-2">
                        <span
                          className={`block h-full ${closed ? 'bg-positive' : 'bg-accent'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
