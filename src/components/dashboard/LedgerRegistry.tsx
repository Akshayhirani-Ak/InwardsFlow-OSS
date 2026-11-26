// InwardsFlow — Ledger Registry (Phase 28)
// The dashboard's one list: consignments grouped by PO reference (the
// warehouse's main ID), state as plain-type tabs, each row a ledger line —
// status stripe, fraction, thin progress track, exceptions named only
// when they exist. Replaces the KPI cards / donut / bar chart / board
// stack: a supervisor answers "what needs attention?" in five seconds.
// Grouping math mirrors the old registry section exactly (received =
// good units only, consignment status derived from its containers).
'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import type { Consignment, Container, ExpectedItem, Pallet, PalletEntry } from '@/types/wms';
import { Search, ChevronDown, FileSpreadsheet, Package, Layers, Check } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cleanDisplay } from '@/lib/utils/auth-mapper';

type LedgerState = 'waiting' | 'counting' | 'done';

interface LedgerRow {
  key: string;
  isConsignment: boolean;
  consignment?: Consignment;
  containers: Container[];
  supplierName: string;
  refNumber: string;
  arrivalMode: string;
  status: string;
  state: LedgerState;
  expectedUnits: number;
  receivedUnits: number;
  damagedUnits: number;
  linesTotal: number;
  linesCounted: number;
  shortLines: number;
  pct: number;
  totalPallets: number;
  latestAt: string;
  operatorLabel: string;
}

interface LedgerRegistryProps {
  consignments: Consignment[];
  containers: Container[];
  items: ExpectedItem[];
  pallets: Pallet[];
  entries: PalletEntry[];
  isMaster: boolean;
  registryCapped?: boolean;
  onOpenGrn: (containerId: string) => void;
  onReopenContainer?: (containerId: string) => Promise<void>;
  onDeleteContainer?: (containerId: string) => Promise<void>;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const time = new Intl.DateTimeFormat('en-NZ', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Pacific/Auckland',
  }).format(d);
  if (sameDay(d, now)) return `Today ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return `Yesterday ${time}`;
  return new Intl.DateTimeFormat('en-NZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Pacific/Auckland',
  }).format(d);
}

export function LedgerRegistry({
  consignments,
  containers,
  items,
  pallets,
  entries,
  isMaster,
  registryCapped = false,
  onOpenGrn,
  onReopenContainer,
  onDeleteContainer,
}: LedgerRegistryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const rows = useMemo<LedgerRow[]>(() => {
    const consMap = new Map<string, Container[]>();
    const standalone: Container[] = [];
    for (const c of containers) {
      if (c.consignment_id) {
        const list = consMap.get(c.consignment_id) || [];
        list.push(c);
        consMap.set(c.consignment_id, list);
      } else {
        standalone.push(c);
      }
    }

    const build = (
      key: string,
      isConsignment: boolean,
      consignment: Consignment | undefined,
      units: Container[],
      supplierName: string,
      refNumber: string,
      arrivalMode: string,
      rawStatus: string
    ): LedgerRow => {
      const gItems = items.filter((i) => units.some((u) => u.id === i.container_id));
      const gEntries = entries.filter((e) => !e.is_voided && units.some((u) => u.id === e.container_id));
      const gPallets = pallets.filter((p) => units.some((u) => u.id === p.container_id));
      const exp = gItems.reduce((s, i) => s + (Number(i.expected_total_qty) || 0), 0);
      const rec = gEntries.reduce((s, e) => s + (Number(e.good_qty) || 0), 0);
      const dmg = gEntries.reduce((s, e) => s + (Number(e.damaged_qty) || 0), 0);

      const goodByItem = new Map<string, number>();
      gEntries.forEach((e) => goodByItem.set(e.item_id, (goodByItem.get(e.item_id) || 0) + (Number(e.good_qty) || 0)));
      const linesCounted = gItems.filter((i) => (goodByItem.get(i.id) || 0) > 0).length;

      const status =
        units.length > 0 && units.every((u) => u.status === 'completed')
          ? 'completed'
          : units.some((u) => u.status === 'paused')
            ? 'paused'
            : rawStatus;
      const state: LedgerState =
        status === 'completed'
          ? 'done'
          : linesCounted > 0 || status === 'paused'
            ? 'counting'
            : 'waiting';
      const shortLines =
        state === 'done'
          ? gItems.filter((i) => (goodByItem.get(i.id) || 0) < (Number(i.expected_total_qty) || 0)).length
          : 0;
      const latestAt = units.reduce(
        (max, u) => (u.created_at > max ? u.created_at : max),
        units[0]?.created_at || new Date(0).toISOString()
      );
      const opRaw = units[0]?.assigned_operator_user_id;
      return {
        key,
        isConsignment,
        consignment,
        containers: [...units].sort((a, b) => (a.sequence_index || 1) - (b.sequence_index || 1)),
        supplierName,
        refNumber,
        arrivalMode,
        status,
        state,
        expectedUnits: exp,
        receivedUnits: rec,
        damagedUnits: dmg,
        linesTotal: gItems.length,
        linesCounted,
        shortLines,
        pct: exp > 0 ? Math.min(100, Math.round((rec / exp) * 100)) : 0,
        totalPallets: gPallets.length,
        latestAt,
        operatorLabel: opRaw && opRaw !== 'ALL' ? cleanDisplay(opRaw) : '',
      };
    };

    const out: LedgerRow[] = [];
    for (const cons of consignments) {
      const units = consMap.get(cons.id);
      if (!units) continue;
      out.push(
        build(
          cons.id,
          true,
          cons,
          units,
          cons.supplier_name || 'Standard Inbound',
          cons.consignment_ref,
          cons.arrival_type || 'CONTAINER',
          cons.status
        )
      );
    }
    for (const cont of standalone) {
      out.push(
        build(
          cont.id,
          false,
          undefined,
          [cont],
          cont.supplier_name || 'Inbound Supplier',
          cont.document_ref || cont.container_number,
          cont.arrival_type || 'CONTAINER',
          cont.status
        )
      );
    }
    // Counting first (that's the live work), then waiting, then done;
    // newest first inside each state.
    const rank: Record<LedgerState, number> = { counting: 0, waiting: 1, done: 2 };
    return out.sort((a, b) => rank[a.state] - rank[b.state] || (a.latestAt < b.latestAt ? 1 : -1));
  }, [consignments, containers, items, pallets, entries]);

  const counts = useMemo(
    () => ({
      waiting: rows.filter((r) => r.state === 'waiting').length,
      counting: rows.filter((r) => r.state === 'counting').length,
      done: rows.filter((r) => r.state === 'done').length,
    }),
    [rows]
  );

  const [tab, setTab] = useState<LedgerState | null>(null);
  const activeTab: LedgerState =
    tab ?? (counts.counting > 0 ? 'counting' : counts.waiting > 0 ? 'waiting' : 'done');

  const visible = rows.filter((r) => {
    if (r.state !== activeTab) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.refNumber.toLowerCase().includes(q) ||
      r.supplierName.toLowerCase().includes(q) ||
      r.containers.some(
        (c) =>
          c.container_number.toLowerCase().includes(q) ||
          (c.dock_door || '').toLowerCase().includes(q)
      )
    );
  });

  const handleExport = () => {
    const wb = XLSX.utils.book_new();
    const excelRows = visible.map((row) => ({
      'Consignment Reference': row.refNumber,
      'Supplier Name': row.supplierName,
      'Arrival Mode': row.arrivalMode,
      'Units Total': row.containers.length,
      Status: row.status.toUpperCase(),
      'Pallets Staged': row.totalPallets,
      'Expected Units (PCS)': row.expectedUnits,
      'Received Units (PCS)': row.receivedUnits,
      Variance: row.receivedUnits - row.expectedUnits,
      'Completion %': `${row.pct}%`,
      'Container Numbers': row.containers.map((c) => c.container_number).join(', '),
    }));
    const ws = XLSX.utils.json_to_sheet(excelRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Inwards Consignments Registry');
    XLSX.writeFile(wb, `INWARDS_REGISTRY_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const stripe = (r: LedgerRow) =>
    r.damagedUnits > 0 || r.shortLines > 0
      ? 'bg-warning'
      : r.state === 'done'
        ? 'bg-positive'
        : r.state === 'counting'
          ? 'bg-accent'
          : 'bg-transparent';

  const tabBtn = (state: LedgerState, label: string, n: number) => {
    const Icon = { waiting: Package, counting: Layers, done: Check }[state];
    return (
    <button
      type="button"
      onClick={() => setTab(state)}
      aria-pressed={activeTab === state}
      className="registry-stat"
    >
      <span>{label}</span> <strong>{n}</strong><i aria-hidden="true"><Icon size={18} strokeWidth={1.75} /></i>
    </button>
  ); };

  return (
    <div className="space-y-6">
      {/* Tabs + search + export */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          {tabBtn('waiting', 'Waiting', counts.waiting)}
          {tabBtn('counting', 'Counting', counts.counting)}
          {tabBtn('done', 'Done', counts.done)}
        </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 sm:px-6">
          {registryCapped && (
            <span className="text-xs font-medium text-warning">
              showing the 200 most recent in this range
            </span>
          )}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" strokeWidth={1.75} />
            <input
              type="text"
              placeholder="Search PO, container, supplier…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-[13px] bg-white border border-edge rounded-control focus:outline-none focus:ring-1 focus:ring-accent w-56"
            />
          </div>
          <button
            type="button"
            onClick={handleExport}
            className="text-[13px] font-semibold text-secondary hover:text-ink flex items-center gap-1.5"
          >
            <FileSpreadsheet className="w-4 h-4" strokeWidth={1.75} />
            Export
          </button>
        </div>
      {/* Ledger rows */}
      <div className="divide-y divide-line">
        {visible.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted">
            Nothing {activeTab === 'done' ? 'completed' : activeTab} in this range.
          </div>
        ) : (
          visible.map((row) => {
            const firstOpen = row.containers.find((c) => c.status !== 'completed') || row.containers[0];
            const isExpanded = Boolean(expanded[row.key]);
            return (
              <div key={row.key} className={row.state === 'done' ? 'opacity-70' : ''}>
                <div className="flex items-stretch">
                  <div className={`w-1 flex-shrink-0 ${stripe(row)}`} />
                  <div className="flex-1 min-w-0 px-4 py-3">
                    <div className="flex items-baseline gap-2">
                      <Link
                        href={row.state === 'done' ? '#' : `/workbench/${firstOpen?.id}`}
                        onClick={(e) => {
                          if (row.state === 'done') {
                            e.preventDefault();
                            if (firstOpen) onOpenGrn(firstOpen.id);
                          }
                        }}
                        className="font-mono text-[15px] font-semibold text-ink hover:text-accent break-all leading-snug"
                      >
                        {row.refNumber}
                      </Link>
                      <span className="text-[13px] text-secondary truncate">{row.supplierName}</span>
                      {row.containers.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setExpanded((p) => ({ ...p, [row.key]: !p[row.key] }))}
                          className="text-xs font-semibold text-secondary hover:text-ink flex items-center gap-0.5"
                          aria-expanded={isExpanded}
                        >
                          {row.containers.length} units
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} strokeWidth={2} />
                        </button>
                      )}
                      <span className="ml-auto tabular-nums whitespace-nowrap">
                        <span className="text-base font-bold text-ink">
                          {row.linesCounted}
                        </span>{' '}
                        <span className="text-sm text-muted">/ {row.linesTotal} lines</span>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted tabular-nums">
                      <span>{fmtWhen(row.latestAt)}</span>
                      {row.operatorLabel && <span>· {row.operatorLabel}</span>}
                      <span>
                        · {row.receivedUnits.toLocaleString()} / {row.expectedUnits.toLocaleString()} pcs
                      </span>
                      {row.status === 'paused' && (
                        <span className="font-bold text-warning">PAUSED</span>
                      )}
                      {row.damagedUnits > 0 && (
                        <span className="font-bold text-danger">
                          {row.damagedUnits.toLocaleString()} DAMAGED
                        </span>
                      )}
                      {row.shortLines > 0 && (
                        <span className="font-bold text-warning">
                          {row.shortLines} SHORT
                        </span>
                      )}
                    </div>
                    <div className="h-[3px] bg-soft mt-2 overflow-hidden">
                      <div
                        className={`h-full ${row.state === 'done' ? 'bg-positive' : 'bg-accent'}`}
                        style={{ width: `${row.pct}%` }}
                      />
                    </div>

                    {/* Row actions */}
                    <div className="flex flex-wrap gap-4 mt-2 text-[13px] font-semibold">
                      {row.state !== 'done' && firstOpen && (
                        <Link href={`/workbench/${firstOpen.id}`} className="text-accent hover:underline">
                          Open in workbench
                        </Link>
                      )}
                      {firstOpen && (
                        <button type="button" onClick={() => onOpenGrn(firstOpen.id)} className="text-secondary hover:text-ink">
                          Goods Received (GRN)
                        </button>
                      )}
                      {isMaster && row.containers.length === 1 && row.status === 'completed' && onReopenContainer && (
                        <button
                          type="button"
                          onClick={() => void onReopenContainer(row.containers[0].id)}
                          className="text-secondary hover:text-ink"
                        >
                          Reopen
                        </button>
                      )}
                      {isMaster && row.containers.length === 1 && onDeleteContainer && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Delete container ${row.containers[0].container_number}? It will be hidden from the dashboard. This cannot be undone from the app.`)) {
                              void onDeleteContainer(row.containers[0].id);
                            }
                          }}
                          className="text-danger hover:underline"
                        >
                          Delete
                        </button>
                      )}
                    </div>

                    {/* Expanded unit rows for multi-container consignments */}
                    {isExpanded &&
                      row.containers.map((c) => (
                        <div
                          key={c.id}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 pt-2 border-t border-line text-[13px]"
                        >
                          <span className="font-mono font-semibold text-ink">{c.container_number}</span>
                          <span
                            className={`text-xs font-bold ${
                              c.status === 'completed'
                                ? 'text-positive'
                                : c.status === 'paused'
                                  ? 'text-warning'
                                  : 'text-accent'
                            }`}
                          >
                            {c.status.toUpperCase()}
                          </span>
                          <span className="ml-auto flex gap-4 font-semibold">
                            {c.status !== 'completed' && (
                              <Link href={`/workbench/${c.id}`} className="text-accent hover:underline">
                                Open
                              </Link>
                            )}
                            <button type="button" onClick={() => onOpenGrn(c.id)} className="text-secondary hover:text-ink">
                              GRN
                            </button>
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      </Card>
    </div>
  );
}
