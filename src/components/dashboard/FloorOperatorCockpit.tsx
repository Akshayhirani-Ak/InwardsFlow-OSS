// InwardsFlow — Floor Operator Dock Tasks (Phase 28, Ledger)
// The operator's list: no greeting banner, no stat boxes, no cards —
// ledger rows with a status stripe, the count fraction, and one clear
// action per row. Rows are ≥64px: glove-friendly tap targets.
'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import type { Container, ExpectedItem, Pallet, PalletEntry } from '@/types/wms';
import { toCleanUserId } from '@/lib/utils/auth-mapper';
import { Search, CheckCircle2, ArrowRight } from 'lucide-react';

interface FloorOperatorCockpitProps {
  containers: Container[];
  items: ExpectedItem[];
  pallets: Pallet[];
  entries: PalletEntry[];
  currentUserId: string;
  userName: string;
}

export function FloorOperatorCockpit({
  containers,
  items,
  pallets,
  entries,
  currentUserId,
  userName,
}: FloorOperatorCockpitProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'paused'>('ALL');

  // Filter tasks assigned to 'ALL' or current operator
  const assignedContainers = useMemo(() => {
    return containers.filter((c) => {
      if (c.status === 'completed') return false;
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      const assigned = toCleanUserId(c.assigned_operator_user_id || 'ALL').toLowerCase();
      const current = currentUserId.toLowerCase();
      if (assigned !== 'all' && assigned !== current) {
        return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const numMatch = c.container_number.toLowerCase().includes(q);
        const supMatch = (c.supplier_name || '').toLowerCase().includes(q);
        const doorMatch = (c.dock_door || '').toLowerCase().includes(q);
        const docMatch = (c.document_ref || '').toLowerCase().includes(q);
        if (!numMatch && !supMatch && !doorMatch && !docMatch) return false;
      }
      return true;
    });
  }, [containers, statusFilter, currentUserId, searchQuery]);

  const pausedCount = assignedContainers.filter((c) => c.status === 'paused').length;

  const tabBtn = (value: 'ALL' | 'active' | 'paused', label: string) => (
    <button
      type="button"
      onClick={() => setStatusFilter(value)}
      className={`pb-2 -mb-px ${
        statusFilter === value
          ? 'text-ink font-semibold border-b-2 border-accent'
          : 'text-secondary hover:text-ink'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Header — one line of truth, no banner */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold text-ink tracking-tight">Dock tasks</h1>
        <p className="text-[13px] text-muted tabular-nums">
          {assignedContainers.length} assigned to {userName || currentUserId}
          {pausedCount > 0 ? ` · ${pausedCount} on hold` : ''}
        </p>
      </div>

      <div className="bg-surface rounded-card shadow-rest">
        {/* Filter tabs + search */}
        <div className="flex flex-wrap items-end justify-between gap-3 px-4 sm:px-5 pt-3 border-b border-line">
          <div className="flex gap-5 text-sm">
            {tabBtn('ALL', `All open (${assignedContainers.length})`)}
            {tabBtn('active', 'Active')}
            {tabBtn('paused', 'Paused')}
          </div>
          <div className="relative pb-2">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-[13px] -translate-y-1/2 text-muted" strokeWidth={1.75} />
            <input
              type="text"
              placeholder="Search container, door, shipper…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-[13px] bg-white border border-edge rounded-control focus:outline-none focus:ring-1 focus:ring-accent w-56"
            />
          </div>
        </div>

        {/* Task rows */}
        {assignedContainers.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-positive mx-auto mb-3" strokeWidth={1.5} />
            <h3 className="text-[15px] font-semibold text-ink">No active inwards tasks assigned</h3>
            <p className="text-[13px] text-muted max-w-md mx-auto mt-1">
              All current dock work has been completed or assigned to other operators.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {assignedContainers.map((c) => {
              const cItems = items.filter((i) => i.container_id === c.id);
              const cEntries = entries.filter((e) => !e.is_voided && e.container_id === c.id);
              const cPallets = pallets.filter((p) => p.container_id === c.id);

              const expectedTotal = cItems.reduce((s, i) => s + (Number(i.expected_total_qty) || 0), 0);
              const goodTotal = cEntries.reduce((s, e) => s + (Number(e.good_qty) || 0), 0);
              const damagedTotal = cEntries.reduce((s, e) => s + (Number(e.damaged_qty) || 0), 0);
              const countedTotal = goodTotal + damagedTotal;
              const pct = expectedTotal > 0 ? Math.min(100, Math.round((countedTotal / expectedTotal) * 100)) : 0;

              return (
                <Link key={c.id} href={`/workbench/${c.id}`} className="flex items-stretch hover:bg-soft transition-colors">
                  <div className={`w-1 flex-shrink-0 ${c.status === 'paused' ? 'bg-warning' : 'bg-accent'}`} />
                  <div className="flex-1 min-w-0 px-4 py-3.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[17px] font-bold text-ink break-all leading-snug">
                        {c.container_number}
                      </span>
                      <span className="text-[13px] text-secondary truncate">
                        {c.supplier_name || 'Standard Inbound'}
                      </span>
                      <span className="ml-auto tabular-nums whitespace-nowrap">
                        <span className="text-base font-bold text-ink">{countedTotal.toLocaleString()}</span>{' '}
                        <span className="text-sm text-muted">/ {expectedTotal.toLocaleString()} pcs</span>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-3 mt-0.5 text-xs text-muted tabular-nums">
                      <span>
                        {c.arrival_type || 'CONTAINER'}
                        {c.container_size ? ` · ${c.container_size}` : ''}
                      </span>
                      {c.dock_door && <span>· Door {c.dock_door}</span>}
                      {c.document_ref && <span>· Ref {c.document_ref}</span>}
                      <span>
                        · {cPallets.length} pallet{cPallets.length === 1 ? '' : 's'} · {cItems.length} products
                      </span>
                      {damagedTotal > 0 && (
                        <span className="font-bold text-danger">{damagedTotal.toLocaleString()} DAMAGED</span>
                      )}
                      {c.status === 'paused' && <span className="font-bold text-warning">PAUSED</span>}
                    </div>
                    <div className="h-[3px] bg-soft mt-2 overflow-hidden">
                      <div
                        className={`h-full ${c.status === 'paused' ? 'bg-warning' : 'bg-accent'}`}
                        style={{ width: `${Math.min(100, Math.max(pct, countedTotal > 0 ? 3 : 0))}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center pr-4">
                    <span className="text-sm font-semibold text-accent flex items-center gap-1 whitespace-nowrap">
                      {countedTotal > 0 ? 'Resume' : 'Start'} counting
                      <ArrowRight className="w-4 h-4" strokeWidth={2} />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
