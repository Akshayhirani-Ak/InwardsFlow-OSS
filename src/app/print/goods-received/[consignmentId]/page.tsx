'use client';

// InwardsFlow — Phase 23: printable Goods Received list.
//
// The handover sheet for the other team: what was actually received,
// nothing else. Layout follows the purchase-order printout the floor
// already reads every day — InwardsFlow wordmark, GOODS RECEIVED title,
// supplier box, full-grid line tables in PO column order (Product Code ·
// Supplier Code · Received · Unit · Description), totals box, the digital
// sign-off names recorded at finalize, and the red RECEIVED stamp.
//
// The route accepts a consignment id (the whole delivery) or a standalone
// container id. Data loads under the signed-in user's RLS, exactly like
// the pallet slip — an unrelated user opening this URL gets nothing.

import { rpcErrorMessage } from '@/lib/utils/errors';
import { readAllRows } from '@/lib/supabase/read-all-rows';
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import {
  buildGoodsReceivedLines,
  summariseGoodsReceived,
  type GoodsReceivedLine,
} from '@/lib/reports/goods-received';
import type { Consignment, Container, ExpectedItem, PalletEntry } from '@/types/wms';

const NAVY = '#081C3A';
const BLUE = '#1849B2';
const RED = '#C0272D';
const GREY = '#5A5A5A';
const GRID = '#3f3f46';

const dateFmt = new Intl.DateTimeFormat('en-NZ', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Pacific/Auckland',
});

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

interface Section {
  container: Container;
  lines: GoodsReceivedLine[];
}

export default function GoodsReceivedPage() {
  const params = useParams<{ consignmentId: string }>();
  const router = useRouter();
  const [consignment, setConsignment] = useState<Consignment | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [items, setItems] = useState<ExpectedItem[]>([]);
  const [entries, setEntries] = useState<PalletEntry[]>([]);
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
      const id = params.consignmentId;

      // Resolve the delivery: a consignment id covers all its containers;
      // a container id covers its consignment when it belongs to one, or
      // just itself when standalone.
      let cons: Consignment | null = null;
      let conts: Container[] = [];

      const { data: consRow } = await supabase
        .from('consignments')
        .select('*')
        .eq('id', id)
        .maybeSingle().throwOnError();
      if (consRow) {
        cons = consRow as unknown as Consignment;
        const { data: contRows } = await supabase
          .from('containers')
          .select('*')
          .eq('consignment_id', id)
          .is('deleted_at', null)
          .order('sequence_index', { ascending: true }).throwOnError();
        conts = (contRows as unknown as Container[]) || [];
      } else {
        const { data: contRow } = await supabase
          .from('containers')
          .select('*')
          .eq('id', id)
          .is('deleted_at', null)
          .maybeSingle().throwOnError();
        if (!current) return;
        if (!contRow) {
          setErrorText('Delivery not found, or you do not have access to it.');
          setState('error');
          return;
        }
        const single = contRow as unknown as Container;
        if (single.consignment_id) {
          const [{ data: parentRow }, { data: siblings }] = await Promise.all([
            supabase.from('consignments').select('*').eq('id', single.consignment_id).maybeSingle().throwOnError(),
            supabase
              .from('containers')
              .select('*')
              .eq('consignment_id', single.consignment_id)
              .is('deleted_at', null)
              .order('sequence_index', { ascending: true }).throwOnError(),
          ]);
          cons = (parentRow as unknown as Consignment) || null;
          conts = (siblings as unknown as Container[]) || [single];
        } else {
          conts = [single];
        }
      }

      if (!current) return;
      if (conts.length === 0) {
        setErrorText('This delivery has no containers yet.');
        setState('error');
        return;
      }
      setConsignment(cons);
      setContainers(conts);

      const ids = conts.map((c) => c.id);
      const [itemRows, entryRows] = await Promise.all([
        readAllRows((from, to) => supabase.from('expected_items').select('*').in('container_id', ids).order('id').range(from, to)),
        readAllRows((from, to) => supabase.from('pallet_entries').select('*').in('container_id', ids).order('id').range(from, to)),
      ]);
      if (!current) return;
      setItems((itemRows as unknown as ExpectedItem[]) || []);
      setEntries((entryRows as unknown as PalletEntry[]) || []);
      setState('ready');
    })().catch((error) => {
      if (!current) return;
      setErrorText(rpcErrorMessage(error, 'Unable to load all records for printing.'));
      setState('error');
    });
    return () => { current = false; };
  }, [params.consignmentId, router]);

  const sections: Section[] = useMemo(
    () =>
      containers.map((container) => ({
        container,
        lines: buildGoodsReceivedLines(
          items.filter((i) => i.container_id === container.id),
          entries.filter((e) => e.container_id === container.id)
        ),
      })),
    [containers, items, entries]
  );

  const totals = useMemo(
    () => summariseGoodsReceived(sections.flatMap((s) => s.lines)),
    [sections]
  );

  const ref = consignment?.consignment_ref || containers[0]?.container_number || '';
  const supplier =
    consignment?.supplier_name || containers.find((c) => c.supplier_name)?.supplier_name || '—';
  const documents =
    Array.from(new Set(containers.map((c) => c.document_ref).filter(Boolean))).join(' · ') || '—';
  const receivedDate = useMemo(() => {
    const latest = containers.reduce<string | null>(
      (acc, c) => (c.updated_at && (!acc || c.updated_at > acc) ? c.updated_at : acc),
      null
    );
    return fmtDate(latest);
  }, [containers]);
  const allCompleted =
    containers.length > 0 && containers.every((c) => c.status === 'completed');
  const multi = containers.length > 1;

  if (state === 'loading') {
    return <div style={{ padding: 40, fontFamily: 'Arial, sans-serif' }}>Loading goods received list…</div>;
  }
  if (state === 'error') {
    return (
      <div style={{ padding: 40, fontFamily: 'Arial, sans-serif' }}>
        <p style={{ color: RED, fontWeight: 700 }}>Could not load this list</p>
        <p>{errorText}</p>
      </div>
    );
  }

  const th: React.CSSProperties = {
    border: `1px solid ${GRID}`,
    padding: '4px 6px',
    fontSize: 10,
    textAlign: 'left',
    background: '#fff',
  };
  const td: React.CSSProperties = {
    border: `1px solid ${GRID}`,
    padding: '4px 6px',
    fontSize: 10.5,
    verticalAlign: 'top',
  };

  return (
    <div style={{ background: '#e5e7eb', minHeight: '100vh', padding: '16px 0' }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .sheet { box-shadow: none !important; margin: 0 !important; width: auto !important; }
          .print-footer { position: fixed; bottom: 0; left: 0; right: 0; display: block !important; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
          @page { margin: 12mm; }
        }
        .print-footer { display: none; }
      `}</style>

      <div className="no-print" style={{ maxWidth: 794, margin: '0 auto 12px', display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => window.print()}
          style={{
            background: NAVY,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Print / Save as PDF
        </button>
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          style={{
            background: '#fff',
            color: NAVY,
            border: `1px solid ${NAVY}`,
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Back to dashboard
        </button>
      </div>

      <div
        className="sheet"
        style={{
          background: '#fff',
          width: '100%',
          maxWidth: 794,
          margin: '0 auto',
          padding: '28px 30px 36px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
          fontFamily: 'Arial, Helvetica, sans-serif',
          color: '#111',
        }}
      >
        {/* Header */}
        <div style={{ fontSize: 25, fontWeight: 800, lineHeight: 1 }}>
          <span style={{ color: NAVY }}>Inwards</span>
          <span style={{ color: BLUE }}>Flow</span>
        </div>
        <div style={{ fontSize: 7.5, letterSpacing: 2, color: GREY, marginTop: 2 }}>
          WAREHOUSE RECEIVING
        </div>
        <div style={{ borderBottom: `2px solid ${BLUE}`, marginTop: 6 }} />
        <div style={{ textAlign: 'right', marginTop: 8 }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>GOODS RECEIVED</div>
          <div style={{ fontSize: 10.5, marginTop: 2 }}>
            Ref <b>{ref}</b> · Received {receivedDate}
          </div>
        </div>

        {/* Supplier box */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
          <tbody>
            <tr>
              <td style={{ border: `1px solid ${GRID}`, padding: '3px 6px', fontSize: 9, fontWeight: 700 }}>
                SUPPLIER
              </td>
            </tr>
            <tr>
              <td style={{ border: `1px solid ${GRID}`, padding: '5px 6px', fontSize: 11 }}>
                <b>{supplier}</b>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Info grid */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
          <tbody>
            <tr>
              <td style={{ ...td, width: '16%', fontWeight: 700 }}>Supplier documents</td>
              <td style={{ ...td, width: '44%' }}>{documents}</td>
              <td style={{ ...td, width: '13%', fontWeight: 700 }}>Reference</td>
              <td style={{ ...td, width: '27%' }}>{ref}</td>
            </tr>
          </tbody>
        </table>

        {/* Line sections */}
        {sections.map(({ container, lines }) => (
          <div key={container.id} style={{ marginTop: 14 }}>
            {multi && (
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>
                CONTAINER {container.container_number}
                {container.document_ref ? (
                  <span style={{ fontSize: 9.5, fontWeight: 400, color: GREY }}>
                    {'  '}
                    {container.document_ref}
                  </span>
                ) : null}
              </div>
            )}
            {lines.length === 0 ? (
              <p style={{ fontSize: 10.5, color: GREY, margin: '2px 0 6px' }}>
                No received goods recorded{multi ? ' for this container' : ''} yet.
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: '15%' }}>Product Code</th>
                    <th style={{ ...th, width: '16%' }}>Supplier Code</th>
                    <th style={{ ...th, width: '12%', textAlign: 'right' }}>Received</th>
                    <th style={{ ...th, width: '7%' }}>Unit</th>
                    <th style={{ ...th, width: '50%' }}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.itemId}>
                      <td style={td}>{l.productCode}</td>
                      <td style={td}>{l.supplierCode || '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{l.received.toLocaleString('en-NZ')}</td>
                      <td style={td}>{l.unit}</td>
                      <td style={td}>{l.productName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}

        {/* Totals + sign-off + stamp */}
        <div style={{ display: 'flex', gap: 16, marginTop: 16, alignItems: 'flex-start' }}>
          <table style={{ borderCollapse: 'collapse', width: 206 }}>
            <tbody>
              <tr>
                <td style={td}>Total lines</td>
                <td style={{ ...td, textAlign: 'right', width: 62 }}>{totals.lineCount}</td>
              </tr>
              <tr>
                <td style={td}>Total cartons</td>
                <td style={{ ...td, textAlign: 'right' }}>{totals.totalCartons.toLocaleString('en-NZ')}</td>
              </tr>
              <tr>
                <td style={{ ...td, fontWeight: 700 }}>Total received (pcs)</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                  {totals.totalReceived.toLocaleString('en-NZ')}
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{ fontSize: 10.5, lineHeight: 1.9 }}>
            {containers.map((c) => (
              <div key={c.id}>
                {multi && (
                  <div style={{ fontWeight: 700, fontSize: 9.5, color: GREY }}>
                    Container {c.container_number}
                  </div>
                )}
                <div>
                  <b>Received by:</b>&nbsp;&nbsp;{c.received_by_name || 'Not recorded'}
                </div>
                <div>
                  <b>Checked by:</b>&nbsp;&nbsp;{c.checked_by_name || 'Not recorded'}
                </div>
                <div>
                  <b>Date:</b>&nbsp;&nbsp;{fmtDate(c.updated_at)}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginLeft: 'auto' }}>
            <div
              style={{
                border: `2.5px solid ${allCompleted ? RED : '#94a3b8'}`,
                color: allCompleted ? RED : '#64748b',
                fontWeight: 800,
                fontSize: 15,
                padding: '6px 14px',
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              {allCompleted ? 'RECEIVED' : 'IN PROGRESS'}
            </div>
          </div>
        </div>

        <div
          className="print-footer"
          style={{ textAlign: 'center', fontSize: 7.5, color: GREY, paddingTop: 6 }}
        >
          This list records counted quantities only. Supplier documents are not amended.
          <br />
          Goods Received · InwardsFlow · Ref {ref}
        </div>
      </div>
    </div>
  );
}
