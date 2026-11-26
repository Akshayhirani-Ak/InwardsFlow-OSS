'use client';

// InwardsFlow — Phase 8: printable pallet slip.
//
// One slip per pallet for the physical paperwork that travels with the goods:
// pallet id, container, contents by SKU with cartons and units, seal state.
// Data loads under the signed-in user's RLS, exactly like the workbench —
// an unrelated user opening this URL gets nothing. Print CSS keeps the slip
// clean (the button hides itself; no app chrome lives on this route).

import { rpcErrorMessage } from '@/lib/utils/errors';
import { readAllRows } from '@/lib/supabase/read-all-rows';
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { Container, ExpectedItem, Pallet, PalletEntry } from '@/types/wms';

export default function PalletSlipPage() {
  const params = useParams<{ palletId: string }>();
  const router = useRouter();
  const [pallet, setPallet] = useState<Pallet | null>(null);
  const [container, setContainer] = useState<Container | null>(null);
  const [entries, setEntries] = useState<PalletEntry[]>([]);
  const [itemsMap, setItemsMap] = useState<Record<string, ExpectedItem>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    let current = true;
    setState('loading');
    (async () => {
      const supabase = createBrowserSupabaseClient();
      const {
        data: { session }, error: sessionError,
      } = await supabase.auth.getSession();
      if (!current) return;
      if (sessionError) throw sessionError;
      if (!session) {
        router.replace('/login');
        return;
      }
      const { data: palletRow, error: palletErr } = await supabase
        .from('pallets')
        .select('*')
        .eq('id', params.palletId)
        .single();
      if (!current) return;
      if (palletErr) throw palletErr;
      if (!palletRow) {
        setErrorText('Pallet not found, or you do not have access to it.');
        setState('error');
        return;
      }
      const p = palletRow as unknown as Pallet;
      setPallet(p);

      const [{ data: containerRow }, entryRows, itemRows] = await Promise.all([
        supabase.from('containers').select('*').eq('id', p.container_id).is('deleted_at', null).single().throwOnError(),
        readAllRows((from, to) => supabase.from('pallet_entries').select('*').eq('pallet_id', p.id).order('created_at').order('id').range(from, to)),
        readAllRows((from, to) => supabase.from('expected_items').select('*').eq('container_id', p.container_id).order('id').range(from, to)),
      ]);
      if (!current) return;
      if (containerRow) setContainer(containerRow as unknown as Container);
      setEntries((entryRows as unknown as PalletEntry[]) || []);
      const map: Record<string, ExpectedItem> = {};
      for (const it of (itemRows as unknown as ExpectedItem[]) || []) map[it.id] = it;
      setItemsMap(map);
      setState('ready');
    })().catch((error) => {
      if (!current) return;
      setErrorText(rpcErrorMessage(error, 'Unable to load all records for printing.'));
      setState('error');
    });
    return () => { current = false; };
  }, [params.palletId, router]);

  const lines = useMemo(() => {
    const byItem = new Map<string, { cartons: number; good: number; damaged: number }>();
    for (const e of entries) {
      if (e.is_voided) continue;
      const cur = byItem.get(e.item_id) || { cartons: 0, good: 0, damaged: 0 };
      cur.cartons += e.cartons_counted || 0;
      cur.good += e.good_qty || 0;
      cur.damaged += e.damaged_qty || 0;
      byItem.set(e.item_id, cur);
    }
    return Array.from(byItem.entries()).map(([itemId, v]) => ({
      sku: itemsMap[itemId]?.sku_code || 'UNKNOWN',
      name: itemsMap[itemId]?.product_name || '',
      ...v,
    }));
  }, [entries, itemsMap]);

  const totals = useMemo(
    () => ({
      cartons: lines.reduce((s, l) => s + l.cartons, 0),
      good: lines.reduce((s, l) => s + l.good, 0),
      damaged: lines.reduce((s, l) => s + l.damaged, 0),
    }),
    [lines]
  );

  if (state === 'loading') {
    return <div className="p-8 text-sm text-slate-500">Loading pallet slip…</div>;
  }
  if (state === 'error' || !pallet) {
    return <div className="p-8 text-sm text-red-600">{errorText || 'Could not load this pallet.'}</div>;
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 p-8 print:p-0">
      <div className="max-w-3xl mx-auto border-2 border-slate-900 p-6 print:border-0 print:p-0">
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
          <div>
            <div className="text-[11px] font-mono tracking-widest text-slate-500">INWARDSFLOW — PALLET SLIP</div>
            <div className="text-4xl font-black font-mono mt-1">{pallet.pallet_code}</div>
          </div>
          <div className="text-right text-xs font-mono">
            <div>Status: <strong>{pallet.status.toUpperCase()}</strong></div>
            <div>Created: {new Date(pallet.created_at).toLocaleString('en-NZ')}</div>
            <div>By: {pallet.created_by_name || '—'}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 py-4 text-sm border-b border-slate-300">
          <div>
            <div className="text-[11px] font-mono text-slate-500">CONTAINER / UNIT</div>
            <div className="font-mono font-bold">{container?.container_number || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] font-mono text-slate-500">SUPPLIER</div>
            <div className="font-semibold">{container?.supplier_name || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] font-mono text-slate-500">ARRIVAL</div>
            <div>{container ? `${container.arrival_type} · ${container.container_size}` : '—'}</div>
          </div>
          <div>
            <div className="text-[11px] font-mono text-slate-500">DOCK DOOR</div>
            <div>{container?.dock_door || '—'}</div>
          </div>
        </div>

        <table className="w-full text-sm mt-2">
          <thead>
            <tr className="border-b-2 border-slate-900 text-left">
              <th className="py-2 pr-2">Product Code</th>
              <th className="py-2 pr-2">Product</th>
              <th className="py-2 pr-2 text-right">Boxes</th>
              <th className="py-2 pr-2 text-right">Good</th>
              <th className="py-2 text-right">Damaged</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.sku} className="border-b border-slate-200">
                <td className="py-2 pr-2 font-mono font-bold">{l.sku}</td>
                <td className="py-2 pr-2">{l.name}</td>
                <td className="py-2 pr-2 text-right font-mono">{l.cartons}</td>
                <td className="py-2 pr-2 text-right font-mono font-bold">{l.good.toLocaleString()}</td>
                <td className="py-2 text-right font-mono">{l.damaged > 0 ? l.damaged.toLocaleString() : '—'}</td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-slate-500">
                  No counted units on this pallet yet.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-900 font-bold">
              <td className="py-2" colSpan={2}>TOTAL</td>
              <td className="py-2 text-right font-mono">{totals.cartons}</td>
              <td className="py-2 text-right font-mono">{totals.good.toLocaleString()}</td>
              <td className="py-2 text-right font-mono">{totals.damaged > 0 ? totals.damaged.toLocaleString() : '—'}</td>
            </tr>
          </tfoot>
        </table>

        <div className="flex justify-between items-end mt-8 text-xs text-slate-500">
          <div>
            Received by: ______________________&nbsp;&nbsp;&nbsp; Signature: ______________________
          </div>
          <div className="font-mono">Generated {new Date().toLocaleString('en-NZ')}</div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto mt-4 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="px-4 py-2 bg-slate-900 text-white text-sm font-bold rounded"
        >
          Print Slip
        </button>
      </div>
    </div>
  );
}
