// InwardsFlow Enterprise WMS â€” FlowTask & Shipzen Inspired Dashboard
// InwardsFlow Receiving & Inventory Engine
'use client';
import { Select } from '@/components/ui/Select';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import type { Consignment, Container, ExpectedItem, Pallet, PalletEntry } from '@/types/wms';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthPermissionContext';
import { LedgerRegistry } from '@/components/dashboard/LedgerRegistry';
import { FloorOperatorCockpit } from '@/components/dashboard/FloorOperatorCockpit';
import { GrnReconciliationModal } from '@/components/reports/GrnReconciliationModal';
import {
  Plus,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { readAllRows } from '@/lib/supabase/read-all-rows';
import { rpcErrorMessage } from '@/lib/utils/errors';

type DateRangeOption = 'ALL' | 'YTD' | '12M' | 'MONTH';

export default function DashboardPage() {
  const supabase = createBrowserSupabaseClient();
  const { isMaster, hasPermission, cleanUserId, profile } = useAuth();

  const [consignments, setConsignments] = useState<Consignment[]>([]);
  const [containers, setContainers] = useState<Container[]>([]);
  const [items, setItems] = useState<ExpectedItem[]>([]);
  const [pallets, setPallets] = useState<Pallet[]>([]);
  const [entries, setEntries] = useState<PalletEntry[]>([]);
  // Phase 9: registry cap flag. (Phase 28: the KPI summary RPC went with
  // the KPI cards it fed â€” the ledger computes from the loaded rows.)
  const [registryCapped, setRegistryCapped] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Date Filter Range
  const [dateRange, setDateRange] = useState<DateRangeOption>('ALL');

  // Selected container for GRN modal
  const [selectedGrnContainerId, setSelectedGrnContainerId] = useState<string | null>(null);

  // Phase 9: the dashboard used to download six FULL tables and refetch all
  // of them on every realtime event. Now: the date window is pushed into the
  // queries, dependent tables load only for the containers in the window,
  // everything is capped, KPI numbers come from a server aggregate, and
  // realtime bursts are debounced into one trailing refetch.
  const rangeStartIso = useCallback((): string | null => {
    if (dateRange === 'ALL') return null;
    const now = new Date();
    if (dateRange === 'YTD') return new Date(now.getFullYear(), 0, 1).toISOString();
    if (dateRange === 'MONTH') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString(); // 12M
  }, [dateRange]);

  const registryRequest = useRef(0);
  const fetchRegistryData = useCallback(async () => {
    const request = ++registryRequest.current;
    try {
      setErrorMessage('');
      const from = rangeStartIso();
      const CONTAINER_CAP = 200;


      let containersQ = supabase
        .from('containers')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(CONTAINER_CAP);
      let consignmentsQ = supabase
        .from('consignments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(CONTAINER_CAP);
      if (from) {
        containersQ = containersQ.gte('created_at', from);
        consignmentsQ = consignmentsQ.gte('created_at', from);
      }

      const [cRes, csRes] = await Promise.all([
        containersQ,
        consignmentsQ,
      ]);

      if (request !== registryRequest.current) return;
      if (cRes.error) throw cRes.error;
      if (csRes.error) throw csRes.error;

      const containerRows = (cRes.data as Container[]) || [];
      const ids = containerRows.map((c) => c.id);
      const [itemRows, palletRows, entryRows] = ids.length ? await Promise.all([
        readAllRows((from, to) => supabase.from('expected_items').select('*').in('container_id', ids).order('id').range(from, to)),
        readAllRows((from, to) => supabase.from('pallets').select('*').in('container_id', ids).order('id').range(from, to)),
        readAllRows((from, to) => supabase.from('pallet_entries').select('*').in('container_id', ids).order('created_at', { ascending: false }).order('id').range(from, to)),
      ]) : [[], [], []];
      if (request !== registryRequest.current) return;
      setContainers(containerRows);
      setConsignments((csRes.data as Consignment[]) || []);
      setRegistryCapped(containerRows.length >= CONTAINER_CAP);
      setItems(itemRows as ExpectedItem[]);
      setPallets(palletRows as Pallet[]);
      setEntries(entryRows as PalletEntry[]);
    } catch (err: unknown) {
      if (request !== registryRequest.current) return;
      setErrorMessage(
        rpcErrorMessage(err, 'Unable to synchronise container registry.')
      );
    } finally {
      if (request === registryRequest.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [supabase, rangeStartIso]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchRegistryData();
    }, 3000);
  }, [fetchRegistryData]);

  useEffect(() => {
    fetchRegistryData();

    // Subscribe to realtime updates on containers, consignments, and entries.
    // Events schedule ONE debounced refetch â€” a tally burst on the floor no
    // longer triggers a full reload per keystroke.
    const channel = supabase
      .channel('registry-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'containers' }, () => {
        scheduleRefetch();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consignments' }, () => {
        scheduleRefetch();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pallet_entries' }, () => {
        scheduleRefetch();
      })
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchRegistryData, scheduleRefetch, supabase]);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    fetchRegistryData();
  };

  // Phase 35: reopen requires mandatory reason and enforces 24-hour window
  const handleReopenContainer = async (containerId: string) => {
    const reason = window.prompt(
      'Enter mandatory reason for reopening container (e.g. recount variance, missed pack):'
    );
    if (!reason || !reason.trim()) {
      return;
    }

    try {
      const { error } = await supabase.rpc('reopen_container', {
        p_container_id: containerId,
        p_reason: reason.trim(),
      });

      if (error) throw error;

      fetchRegistryData();
    } catch (err: unknown) {
      setErrorMessage(rpcErrorMessage(err, 'Failed to reopen container.'));
    }
  };

  const handleDeleteContainer = async (containerId: string) => {
    try {
      const { error } = await supabase.rpc('soft_delete_container', {
        p_container_id: containerId,
      });

      if (error) throw error;

      fetchRegistryData();
    } catch (err: unknown) {
      setErrorMessage(rpcErrorMessage(err, 'Failed to delete container.'));
    }
  };

  // Date Filter Filtering
  const isWithinDateRange = useCallback(
    (dateStr: string | undefined) => {
      if (!dateStr || dateRange === 'ALL') return true;
      const d = new Date(dateStr);
      const now = new Date();
      if (dateRange === 'MONTH') {
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      }
      if (dateRange === 'YTD') {
        return d.getFullYear() === now.getFullYear();
      }
      if (dateRange === '12M') {
        const twelveMonthsAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        return d >= twelveMonthsAgo;
      }
      return true;
    },
    [dateRange]
  );

  const filteredEntries = useMemo(
    () => entries.filter((e) => isWithinDateRange(e.created_at)),
    [entries, isWithinDateRange]
  );

  const filteredContainers = useMemo(
    () => containers.filter((c) => isWithinDateRange(c.created_at)),
    [containers, isWithinDateRange]
  );

  const filteredConsignments = useMemo(
    () => consignments.filter((cs) => isWithinDateRange(cs.created_at)),
    [consignments, isWithinDateRange]
  );

  const activeGrnContainer = containers.find((c) => c.id === selectedGrnContainerId) || null;
  const activeGrnItems = items.filter((i) => i.container_id === selectedGrnContainerId);
  const activeGrnPallets = pallets.filter((p) => p.container_id === selectedGrnContainerId);
  const activeGrnEntries = entries.filter((e) => e.container_id === selectedGrnContainerId);

  return (
    <div className="flex-1 max-w-[1536px] w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Error Alert */}
      {errorMessage && (
        <div className="p-4 bg-damage border border-damage text-danger rounded-control text-[13px] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.75} />
          <span>{errorMessage}</span>
        </div>
      )}

      {isLoading ? (
        <div className="p-16 text-center bg-surface rounded-card shadow-rest">
          <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin text-accent" strokeWidth={1.75} />
          <p className="text-[13px] font-medium text-secondary">
            Synchronizing InwardsFlow Fleet...
          </p>
        </div>
      ) : isMaster ? (
        /* ========================================================================= */
        /* A. MASTER LEDGER DASHBOARD (Phase 28)                                     */
        /* One list, state tabs, exceptions first. No KPI cards, no charts:          */
        /* the supervisor's question is "what needs attention?", answered in         */
        /* five seconds by the ledger below.                                         */
        /* ========================================================================= */
        <div className="space-y-4">
          {/* Header row: title + range + sync + intake */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold text-ink tracking-tight">
              Inwards
            </h1>

            <div className="flex items-center gap-3 flex-wrap">
                <Select
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value as DateRangeOption)}
                  className="cursor-pointer"
                >
                  <option value="ALL">All Time</option>
                  <option value="YTD">This Year</option>
                  <option value="12M">Last 12 Months</option>
                  <option value="MONTH">This Month</option>
                </Select>

              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="px-3 py-2 bg-white border border-edge rounded-control text-sm font-medium text-ink hover:bg-soft transition-colors flex items-center gap-1.5"
                title="Refresh Registry"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                <span>Sync</span>
              </button>

              {hasPermission('ai_intake') && (
                <Link href="/intake">
                  <button
                    type="button"
                    className="bg-accent hover:bg-pressed text-white px-4 py-2 rounded-control font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" strokeWidth={2} />
                    <span>New Consignment</span>
                  </button>
                </Link>
              )}
            </div>
          </div>

          <LedgerRegistry
            consignments={filteredConsignments}
            containers={filteredContainers}
            items={items}
            pallets={pallets}
            entries={filteredEntries}
            isMaster={isMaster}
            registryCapped={registryCapped}
            onOpenGrn={(cid) => setSelectedGrnContainerId(cid)}
            onReopenContainer={handleReopenContainer}
            onDeleteContainer={handleDeleteContainer}
          />
        </div>
      ) : (
        /* ========================================================================= */
        /* B. FLOOR OPERATOR COCKPIT                                                 */
        /* ========================================================================= */
        <FloorOperatorCockpit
          containers={containers}
          items={items}
          pallets={pallets}
          entries={entries}
          currentUserId={cleanUserId}
          userName={profile?.full_name || cleanUserId}
        />
      )}

      {/* Official GRN Reconciliation Modal */}
      <GrnReconciliationModal
        isOpen={Boolean(selectedGrnContainerId)}
        onClose={() => setSelectedGrnContainerId(null)}
        container={activeGrnContainer}
        items={activeGrnItems}
        pallets={activeGrnPallets}
        entries={activeGrnEntries}
      />
    </div>
  );
}
