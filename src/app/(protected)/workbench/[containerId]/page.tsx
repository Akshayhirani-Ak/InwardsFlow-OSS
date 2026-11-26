'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Consignment,
  Container,
  ExpectedItem,
  Pallet,
  PalletEntry,
  PackOverrideReason,
  QcReasonCode,
  QcStatus,
  ShortageDisposition,
} from '@/types/wms';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { uploadDamagePhotos, getDamagePhotoSignedUrls } from '@/lib/storage/damagePhotos';
import { useAuth } from '@/context/AuthPermissionContext';
import { useContainerRealtime } from '@/hooks/useContainerRealtime';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { rpcErrorMessage } from '@/lib/utils/errors';
import { supplierAliasPattern } from '@/lib/workbench/supplier-aliases';
import { moveGoodBoxes } from '@/lib/workbench/transfer';
import { queueGetAll } from '@/lib/offline/db';
import { SkuManifestSidebar } from '@/components/workbench/SkuManifestSidebar';
import { PalletManifestSelector } from '@/components/workbench/PalletManifestSelector';
import {
  PalletTallyPad,
  type PalletLocationRow,
  type TransferArgs,
} from '@/components/workbench/PalletTallyPad';
import { PalletLedgerTable } from '@/components/workbench/PalletLedgerTable';
import { GrnReconciliationModal } from '@/components/reports/GrnReconciliationModal';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  ArrowLeft,
  FileSpreadsheet,
  Pause,
  Play,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Users,
  AlertTriangle,
  Layers,
  ChevronUp,
  MoreHorizontal,
  Printer,
} from 'lucide-react';

export default function WorkbenchPage() {
  const params = useParams();
  const router = useRouter();
  const containerId = params?.containerId as string;
  const supabase = createBrowserSupabaseClient();
  const { cleanUserId, profile, isMaster, hasPermission } = useAuth();
  // Lets the offline queue trigger a data reload after a successful sync
  // without a hook-ordering cycle (loadContainerData is defined below).
  const loadContainerDataRef = useRef<(() => Promise<void>) | null>(null);
  const refreshAfterSync = useCallback(() => { void loadContainerDataRef.current?.(); }, []);
  const { isOnline, pendingCount, failedCount, lastError, isSyncing, enqueueTally, flushQueue } =
    useOfflineQueue(refreshAfterSync);

  const [container, setContainer] = useState<Container | null>(null);
  const [consignment, setConsignment] = useState<Consignment | null>(null);
  const [siblingContainers, setSiblingContainers] = useState<Container[]>([]);
  const [items, setItems] = useState<ExpectedItem[]>([]);
  const [pallets, setPallets] = useState<Pallet[]>([]);
  const [entries, setEntries] = useState<PalletEntry[]>([]);
  // Phase 8: signed URLs for damage-photo thumbnails in the ledger (the
  // bucket is private — paths on entries are resolved on demand, 1h expiry).
  const [photoUrlsByEntryId, setPhotoUrlsByEntryId] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const withPhotos = entries.filter((e) => (e.damage_photo_urls?.length ?? 0) > 0);
    if (withPhotos.length === 0) return;
    let cancelled = false;
    (async () => {
      const map: Record<string, string[]> = {};
      for (const e of withPhotos) {
        map[e.id] = await getDamagePhotoSignedUrls(e.damage_photo_urls as string[]);
      }
      if (!cancelled) setPhotoUrlsByEntryId(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [entries]);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedPalletId, setSelectedPalletId] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isGrnModalOpen, setIsGrnModalOpen] = useState(false);
  // Phase 21 (Amendment 8): occasional header actions live behind one
  // "More options" menu — the header itself stays uncluttered.
  const [moreOpen, setMoreOpen] = useState(false);
  // Phone focus mode (24 Nov 2026): on any screen below lg — phone, or
  // a tablet whose browser zoom makes it effectively small — while a
  // product is being counted the manifest collapses to its header bar
  // so the counting band + pallet strip get the screen: the stacked
  // pad cannot fit a 60% cap at that size without clipping RECORD.
  // Tapping the bar reopens the list to pick the next product;
  // picking one collapses it again. Desktop keeps the 60/40 split.
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const mobileCountingFocus = Boolean(selectedItemId) && !mobileListOpen;

  // Pause Modal state
  const [pauseModalOpen, setPauseModalOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState('Shift handover - unloading to resume next shift');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Shortage Disposition Modal on completion
  const [shortageModalOpen, setShortageModalOpen] = useState(false);
  // Phase 23: finalize sign-off gate — both names required, date automatic.
  const [finalizeHasShortages, setFinalizeHasShortages] = useState(false);
  const [receivedByName, setReceivedByName] = useState('');
  const [checkedByName, setCheckedByName] = useState('');
  const [shortageDisposition, setShortageDisposition] =
    useState<ShortageDisposition>('SPLIT_DELIVERY');

  const [aliases, setAliases] = useState<{ supplier: string; codes: Record<string, string> } | null>(null);
  const supplier = (container?.supplier_name || consignment?.supplier_name || '').trim();
  useEffect(() => {
    let current = true;
    if (supplier) {
      const pattern = supplierAliasPattern(supplier);
      void (async () => {
        const { data, error } = await supabase.from('sku_aliases')
          .select('supplier_sku_code, master_sku_code').ilike('supplier_name', pattern);
        if (!current) return;
        if (error) { setErrorMessage(rpcErrorMessage(error)); return; }
        const codes = Object.fromEntries((data ?? []).map(row => [row.supplier_sku_code.toUpperCase(), row.master_sku_code.toUpperCase()]));
        setAliases({ supplier, codes });
      })();
    }
    return () => { current = false; };
  }, [supplier, supabase]);
  const aliasMap = aliases?.supplier === supplier ? aliases.codes : {};

  const canVoid = hasPermission('void_entries');

  // Load container cockpit data & sibling containers
  const loadVersion = useRef(0);
  const loadContainerData = useCallback(async () => {
    if (!containerId) return;
    const request = ++loadVersion.current;
    try {
      setErrorMessage('');
      // Phase 2: the workbench reads through ONE server RPC. In BLIND mode the
      // server strips every expected-quantity field from the payload, so a
      // blind count is blind in the data — not just hidden in the UI.
      const { data: wb, error: wbError } = await supabase.rpc('get_container_workbench', {
        p_container_id: containerId,
      });
      if (request !== loadVersion.current) return;
      if (wbError) throw wbError;

      const workbench = wb as unknown as {
        container: Container | null;
        blind: boolean;
        items: ExpectedItem[];
        pallets: Pallet[];
        entries: PalletEntry[];
      } | null;

      if (!workbench?.container) {
        setErrorMessage('Container not found or access restricted.');
        setIsLoading(false);
        return;
      }

      const activeCont = workbench.container;
      setContainer(activeCont);
      // Blind payloads carry NULL expected fields; normalize to 0 for the UI
      // math (progress/shortage displays stay server-verified at finalize).
      const loadedItems = (workbench.items || []).map((i) => ({
        ...i,
        expected_cartons: i.expected_cartons ?? 0,
        pack_size: i.pack_size ?? 0,
        expected_total_qty: i.expected_total_qty ?? 0,
        partial_cartons: i.partial_cartons ?? 0,
        expected_partial_qty: i.expected_partial_qty ?? 0,
      })) as ExpectedItem[];
      const loadedPallets = workbench.pallets || [];
      const loadedEntries = workbench.entries || [];

      setItems(loadedItems);
      setPallets(loadedPallets);
      setEntries(loadedEntries);

      // Default select first item if none selected
      setSelectedItemId((prev) => loadedItems.some((item) => item.id === prev) ? prev : (loadedItems[0]?.id ?? null));

      // Default select first open pallet or first pallet
      setSelectedPalletId((prev) => {
        if (prev && loadedPallets.some((p) => p.id === prev)) return prev;
        const openPallet = loadedPallets.find((p) => p.status === 'open');
        return openPallet ? openPallet.id : (loadedPallets[0]?.id ?? null);
      });

      // Load Consignment and Sibling Containers if consignment_id exists
      if (activeCont.consignment_id) {
        const [consRes, sibsRes] = await Promise.all([
          supabase.from('consignments').select('*').eq('id', activeCont.consignment_id).maybeSingle(),
          supabase.from('containers').select('*').eq('consignment_id', activeCont.consignment_id).is('deleted_at', null).order('sequence_index', { ascending: true }),
        ]);

        if (request !== loadVersion.current) return;
        if (consRes.error) throw consRes.error;
        if (sibsRes.error) throw sibsRes.error;
        if (consRes.data) {
          setConsignment(consRes.data as Consignment);
        }
        if (sibsRes.data) {
          setSiblingContainers(sibsRes.data as Container[]);
        }
      }
    } catch (err: unknown) {
      if (request !== loadVersion.current) return;
      setErrorMessage(
        rpcErrorMessage(err, 'Unable to load receiving data.')
      );
    } finally {
      if (request === loadVersion.current) setIsLoading(false);
    }
  }, [containerId, supabase]);

  useEffect(() => {
    setIsLoading(true);
    setContainer(null);
    setSiblingContainers([]);
    setConsignment(null);
    setShortageModalOpen(false);
    loadContainerDataRef.current = loadContainerData;
    void loadContainerData();
    const version = loadVersion;
    return () => { ++version.current; };
  }, [loadContainerData]);

  // Realtime subscription
  useContainerRealtime(() => {
    loadContainerData();
  }, containerId);

  // Fast lookup maps
  const itemsMap = useMemo(() => {
    const map: Record<string, ExpectedItem> = {};
    items.forEach((it) => (map[it.id] = it));
    return map;
  }, [items]);

  const palletsMap = useMemo(() => {
    const map: Record<string, Pallet> = {};
    pallets.forEach((p) => (map[p.id] = p));
    return map;
  }, [pallets]);

  // Sku progress map (counted vs expected)
  // Phase 5: "counted" toward completion means GOOD units received.
  // Damaged units are tracked separately and NEVER complete a SKU — the old
  // math (good + damaged) let a fully-damaged line show as 100% received.
  const skuProgressMap = useMemo(() => {
    const map: Record<
      string,
      { counted: number; damaged: number; expected: number; isComplete: boolean; pct: number }
    > = {};

    items.forEach((it) => {
      map[it.id] = {
        counted: 0,
        damaged: 0,
        expected: it.expected_total_qty,
        isComplete: false,
        pct: 0,
      };
    });

    entries
      .filter((e) => !e.is_voided)
      .forEach((e) => {
        if (map[e.item_id]) {
          map[e.item_id].counted += e.good_qty;
          map[e.item_id].damaged += e.damaged_qty;
        }
      });

    items.forEach((it) => {
      const p = map[it.id];
      if (p) {
        p.pct = p.expected > 0 ? (p.counted / p.expected) * 100 : 0;
        p.isComplete = p.counted >= p.expected && p.expected > 0;
      }
    });

    return map;
  }, [items, entries]);

  // Pallet units map (good, damaged, total on each pallet)
  const palletUnitsMap = useMemo(() => {
    const map: Record<string, { good: number; damaged: number; count: number }> = {};
    pallets.forEach((p) => {
      map[p.id] = { good: 0, damaged: 0, count: 0 };
    });

    entries
      .filter((e) => !e.is_voided)
      .forEach((e) => {
        if (!map[e.pallet_id]) {
          map[e.pallet_id] = { good: 0, damaged: 0, count: 0 };
        }
        map[e.pallet_id].good += e.good_qty;
        map[e.pallet_id].damaged += e.damaged_qty;
        map[e.pallet_id].count += 1;
      });

    return map;
  }, [pallets, entries]);

  // Active operators active in this container (recent 30 mins)
  const activeOperators = useMemo(() => {
    const set = new Set<string>();
    const cutoff = Date.now() - 30 * 60 * 1000;
    entries.forEach((e) => {
      if (new Date(e.created_at).getTime() > cutoff) {
        const op = e.operator_user_id || e.operator_name;
        if (op) set.add(op);
      }
    });
    if (set.size === 0 && container?.assigned_operator_user_id) {
      set.add(container.assigned_operator_user_id);
    }
    return Array.from(set);
  }, [entries, container]);

  const selectedItem = items.find((i) => i.id === selectedItemId) || null;
  const targetPallet = pallets.find((p) => p.id === selectedPalletId) || null;
  const countedForSelectedSku = selectedItem ? skuProgressMap[selectedItem.id]?.counted || 0 : 0;

  // Add Unlisted SKU
  const handleAddUnlistedSku = async (sku: {
    sku_code: string;
    product_name: string;
    expected_cartons: number;
    pack_size: number;
  }) => {
    const { data, error } = await supabase.rpc('add_unlisted_item', {
      p_container_id: containerId,
      p_sku_code: sku.sku_code.trim(),
      p_product_name: sku.product_name.trim(),
      p_expected_cartons: sku.expected_cartons,
      p_pack_size: sku.pack_size,
    });
    if (error) throw new Error(rpcErrorMessage(error));
    const item = data as ExpectedItem | null;
    if (!item?.id) throw new Error('No product returned. Refresh before trying again.');
    await loadContainerData();
    setSelectedItemId(item.id);
  };

  // Create next pallet — the code is sequenced server-side (Phase 2 RPC);
  // the old client-side `pallets.length + 1` raced and collided.
  const handleCreatePallet = async () => {
    const { data, error } = await supabase.rpc('create_pallet', {
      p_container_id: containerId,
    });

    if (error) throw error;
    const pallet = data as Pallet | null;
    if (!pallet?.id) throw new Error('No pallet returned. Refresh the pallet list before trying again.');
    setPallets((prev) => [...prev.filter(p => p.id !== pallet.id), pallet]);
    setSelectedPalletId(pallet.id);
  };

  // Seal / Unseal pallet (server RPC — validates container editability)
  const handleToggleSealPallet = async (palletId: string, seal: boolean) => {
    const { data, error } = await supabase.rpc('set_pallet_sealed', {
      p_pallet_id: palletId,
      p_sealed: seal,
    });

    if (error) throw error;
    const updated = data as unknown as Pallet | null;
    if (!updated || updated.id !== palletId) throw new Error('The server did not confirm the pallet status.');
    setPallets((prev) => prev.map((p) => p.id === palletId ? updated : p));
  };

  // Post tally entry
  const handlePostTally = async (data: {
    itemId?: string;
    cartonsCounted: number;
    packSizeUsed: number;
    goodQty: number;
    damagedQty: number;
    qcStatus: QcStatus;
    qcReasonCode: QcReasonCode | string;
    qcRemarks?: string;
    partialCartonQty?: number;
    packOverrideReason?: PackOverrideReason | null;
    photoFiles?: File[];
  }) => {
    // Phase 12: scan mode posts per scanned item (data.itemId); manual
    // modes keep posting against the selected item.
    const tallyItemId = data.itemId ?? selectedItem?.id;
    if (!tallyItemId || !targetPallet) throw new Error('Select a product and an open pallet before recording.');

    // Phase 2: tallies post through the post_tally RPC. The entry UUID is
    // generated here so an offline retry replays the SAME id and the server
    // returns the original row instead of double-counting. Operator identity
    // is derived server-side from the JWT — never sent by the client.
    // (The old direct product_master pack-size write is gone: catalog
    // changes are governed in Phase 7; the override reason stays on the entry.)
    const entryId = crypto.randomUUID();

    // Phase 8: damage photos upload BEFORE the tally posts so their paths
    // ride on the entry. Upload failures never lose the count — the tally
    // posts with whatever uploaded, and the operator is told afterwards.
    // Offline tallies queue without photos (the pad says so up front).
    let photoUrls: string[] = [];
    let photoFailures = 0;
    if (isOnline && data.photoFiles && data.photoFiles.length > 0) {
      const uploaded = await uploadDamagePhotos(containerId, entryId, data.photoFiles);
      photoUrls = uploaded.paths;
      photoFailures = uploaded.failures;
    }

    const rpcArgs = {
      p_entry_id: entryId,
      p_container_id: containerId,
      p_pallet_id: targetPallet.id,
      p_item_id: tallyItemId,
      p_cartons_counted: data.cartonsCounted,
      p_pack_size_used: data.packSizeUsed,
      p_partial_carton_qty: data.partialCartonQty || 0,
      p_good_qty: data.goodQty,
      p_damaged_qty: data.damagedQty,
      p_qc_status: data.qcStatus,
      p_qc_reason_code: data.qcReasonCode,
      p_qc_remarks: data.qcRemarks || null,
      p_pack_override_reason: data.packOverrideReason || null,
      p_damage_photo_urls: photoUrls,
    };

    if (!isOnline) {
      // Phase 6: queued is NOT posted. The tally pad is told the outcome so
      // it shows "saved on this device" instead of the success chime.
      await enqueueTally(rpcArgs);
      return 'queued' as const;
    }

    const { data: inserted, error } = await supabase.rpc('post_tally', rpcArgs);

    if (error) throw error;
    if (!inserted || inserted.id !== entryId) throw new Error('No tally receipt returned. Refresh the ledger before retrying.');
    if (photoFailures > 0) {
      setErrorMessage(
        `Tally posted, but ${photoFailures} damage photo(s) failed to upload. The count is saved; re-photograph if the evidence matters.`
      );
    }
    setEntries((prev) => [inserted as PalletEntry, ...prev.filter((e) => e.id !== entryId)]);

    if (container?.status === 'paused') {
      setContainer((prev) => (prev ? { ...prev, status: 'active', pause_reason: null } : null));
    }
    return 'posted' as const;
  };

  // Void entry
  const handleVoidEntry = async (entryId: string, reason: string) => {
    const cleanReason = reason.trim();
    if (!cleanReason) {
      throw new Error('A mandatory void reason is required to satisfy enterprise audit rules.');
    }

    // Server RPC enforces the void_entries permission; the trigger audits it.
    const { data, error } = await supabase.rpc('void_entry', {
      p_entry_id: entryId,
      p_reason: cleanReason,
    });

    if (error) throw error;
    const updated = data as PalletEntry | null;
    if (!updated?.is_voided || updated.id !== entryId) throw new Error('The server did not confirm the void. Refresh the ledger.');
    setEntries((prev) => prev.map((entry) => entry.id === entryId ? updated : entry));
  };

  // 1-Click Move Pallet Entry
  const handleMovePallet = async (entryId: string, newPalletId: string) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) throw new Error('The selected tally is no longer available.');

    // Server RPC validates same-container + open target; trigger audits it.
    const { data, error } = await supabase.rpc('move_entry', {
      p_entry_id: entryId,
      p_target_pallet_id: newPalletId,
    });

    if (error) throw error;

    const moved = data as PalletEntry | null;
    if (!moved || moved.id !== entryId || moved.pallet_id !== newPalletId) throw new Error('No confirmed move returned. Refresh the ledger.');
    setEntries((prev) => prev.map((e) => (e.id === entryId ? moved : e)));

  };

  // Phase 21 (Amendment 6): where the selected product sits, per pallet —
  // computed from the live entries so a transfer's −/+ shows immediately.
  const locationsForSelected = useMemo<PalletLocationRow[]>(() => {
    if (!selectedItem) return [];
    const byPallet = new Map<string, PalletLocationRow>();
    // entries state is newest-first; walk it reversed so each pallet's
    // entry list is oldest-first (transfers consume FIFO).
    const mine = entries
      .filter((e) => e.item_id === selectedItem.id && !e.is_voided)
      .reverse();
    for (const e of mine) {
      const pallet = pallets.find((p) => p.id === e.pallet_id);
      let row = byPallet.get(e.pallet_id);
      if (!row) {
        row = {
          palletId: e.pallet_id,
          palletCode: pallet?.pallet_code || 'PLT-???',
          palletStatus: pallet?.status || 'open',
          boxes: 0,
          goodQty: 0,
          entries: [],
        };
        byPallet.set(e.pallet_id, row);
      }
      row.boxes += e.cartons_counted;
      row.goodQty += e.good_qty;
      row.entries.push({
        id: e.id,
        cartons: e.cartons_counted,
        goodQty: e.good_qty,
        pack: e.pack_size_used,
      });
    }
    return Array.from(byPallet.values())
      .filter((r) => r.boxes > 0)
      .sort((a, b) => a.palletCode.localeCompare(b.palletCode));
  }, [entries, pallets, selectedItem]);

  // Phase 21 (Amendment 6): move N boxes of the selected product from one
  // pallet to another (or a new one). Pure debit/credit — the RPC moves
  // them entry by entry (FIFO); totals for the product never change.
  const handleTransfer = async (args: TransferArgs) => {
    const row = locationsForSelected.find((r) => r.palletId === args.fromPalletId);
    if (!row) throw new Error('Nothing to move from that pallet.');
    try {
      const entries = row.entries.map((e) => ({ ...e, packSizeUsed: e.pack }));
      const result = await moveGoodBoxes(entries, args.boxes, args.toPalletId, (params) =>
        supabase.rpc('transfer_cartons', params));
      if (result.leftoverBoxes) throw new Error(`Moved ${result.movedBoxes} boxes. ${result.leftoverBoxes} could not be moved as full good boxes.`);
    } finally {
      await loadContainerData();
    }
  };

  const changePauseStatus = async (pause: boolean) => {
    try {
      setIsUpdatingStatus(true);
      const { data, error } = pause
        ? await supabase.rpc('pause_container', { p_container_id: containerId, p_reason: pauseReason.trim() })
        : await supabase.rpc('resume_container', { p_container_id: containerId });
      if (error) throw error;
      if (!data || data.id !== containerId) throw new Error('No container returned. Refresh to check its status.');
      setContainer(data as Container);
      setPauseModalOpen(false);
    } catch (error) {
      alert(rpcErrorMessage(error, 'Unable to change receiving status.'));
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Trigger Completion Flow (check for shortages)
  const handleInitiateCompletion = async () => {
    // Phase 24: never close a container over unsynced counts. Tallies
    // queued on THIS device (offline dead-zone work) are not in the
    // server's numbers yet — finalizing would close the container short
    // and strand them. Try to sync first; if any tally for this container
    // is still queued afterwards, refuse and say why.
    const queuedForContainer = async () =>
      (await queueGetAll()).filter((e) => e.payload?.p_container_id === containerId);
    if ((await queuedForContainer()).length > 0) {
      if (isOnline) await flushQueue();
      const stillQueued = await queuedForContainer();
      if (stillQueued.length > 0) {
        setErrorMessage(
          `${stillQueued.length} ${stillQueued.length === 1 ? 'tally' : 'tallies'} for this container still queued on this device — not yet synced. Reconnect and let the sync finish before closing: closing now would finalize without those counts.`
        );
        return;
      }
    }

    // Check if any items have a shortage
    const hasShortages = items.some((it) => {
      const prog = skuProgressMap[it.id];
      return prog && prog.counted < prog.expected;
    });

    // Phase 23: completion ALWAYS goes through the sign-off dialog. The
    // shortage classification shows only when something is short; the two
    // names are required either way — the server refuses to finalize
    // without them.
    setFinalizeHasShortages(hasShortages);
    setShortageDisposition('SPLIT_DELIVERY');

    setReceivedByName(profile?.full_name || '');
    setCheckedByName('');
    setShortageModalOpen(true);
  };

  // Finalize container in Supabase
  const executeFinalizeContainer = async (
    disposition: ShortageDisposition | null,
    receivedBy: string,
    checkedBy: string
  ) => {
    try {
      setIsUpdatingStatus(true);
      if (!receivedBy.trim() || !checkedBy.trim() || receivedBy.trim().toLowerCase() === checkedBy.trim().toLowerCase()) {
        throw new Error('Received by and Checked by must be two different people.');
      }
      const pending = (await queueGetAll()).some((tally) => tally.payload?.p_container_id === containerId);
      if (pending) throw new Error('A tally for this delivery is still on this device. Sync it before finalising.');

      // Phase 2: finalize is a server RPC. Completion % is COMPUTED from good
      // qty (the old code stamped 100 unconditionally), the shortage
      // disposition is applied server-side to genuinely short items, unsealed
      // pallets block finalization, and the trigger writes the audit row.
      // Phase 23: the RPC also requires the two sign-off names and stores
      // them on the container — the digital replacement for the paper
      // signature on the Goods Received list.
      const { data, error } = await supabase.rpc('finalize_container', {
        p_container_id: containerId,
        p_force_open_pallets: false,
        p_shortage_disposition: disposition,
        p_received_by_name: receivedBy.trim(),
        p_checked_by_name: checkedBy.trim(),
      });

      if (error) throw error;

      const finalized = data as unknown as Container | null;
      if (!finalized || finalized.id !== containerId || finalized.status !== 'completed') {
        throw new Error('The server did not confirm finalisation. Refresh to check this delivery.');
      }
      setContainer(finalized);
      setShortageModalOpen(false);
    } catch (err: unknown) {
      alert(rpcErrorMessage(err, 'Unable to finalise the delivery.'));
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12">
        <RefreshCw className="w-8 h-8 animate-spin text-accent mb-3" />
        <p className="font-mono text-xs font-semibold text-ink">
          Loading InwardsFlow Container Cockpit...
        </p>
      </div>
    );
  }

  if (errorMessage || !container) {
    return (
      <div className="flex-1 max-w-lg mx-auto p-8 my-auto text-center">
        <div className="p-4 bg-damage border border-damage rounded-xl text-danger text-xs">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 text-danger" />
          <h3 className="font-bold text-sm">Container Cockpit Error</h3>
          <p className="mt-1">{errorMessage || 'Container record not found.'}</p>
        </div>
        <Link href="/dashboard" className="inline-block mt-4">
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
            Return to Floor Registry
          </Button>
        </Link>
      </div>
    );
  }

  const unitSwitcher = siblingContainers.length > 1 && (
    <select
      aria-label="Switch receiving unit"
      value={containerId}
      onChange={(event) => router.push(`/workbench/${event.target.value}`)}
      className="h-12 w-full rounded-control border border-edge bg-white px-2 font-mono text-xs"
    >
      {siblingContainers.map((sib) => (
        <option key={sib.id} value={sib.id}>
          Unit {sib.sequence_index || 1}: {sib.container_number} ({sib.status})
        </option>
      ))}
    </select>
  );

  return (
    <div className="counting-workbench flex flex-1 flex-col min-h-0">
      {unitSwitcher && (
        <div className="min-[720px]:hidden bg-white px-2 pb-1">
          <div className="font-mono text-[11px] text-muted">
            Consignment: <strong className="text-ink">{consignment?.consignment_ref || container.document_ref}</strong> ({siblingContainers.length} units)
          </div>
          {unitSwitcher}
        </div>
      )}
      {/* Top Cockpit Header Bar — Phase 28 (Ledger): flat 48px-style bar,
          identity as type, status as a coloured word, sync as a text line */}
      <div className="counting-container-bar bg-white border-b border-line px-2 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1 min-w-0 sm:gap-4">
          <Link href="/dashboard">
            <span className="inline-flex min-h-12 items-center px-2 text-xs font-semibold text-secondary hover:bg-soft">
              <ArrowLeft className="w-4 h-4 mr-1" strokeWidth={1.75} />
              Registry
            </span>
          </Link>

          <div className="hidden sm:block h-4 w-px bg-edge" />
          <span className="sm:hidden min-w-0 truncate font-mono font-bold text-sm">{container.container_number}</span>

          <div className="hidden sm:block min-w-0">
            <div className="flex items-center gap-2 whitespace-nowrap overflow-hidden">
              <span className="font-mono text-lg lg:text-xl font-bold text-ink tracking-tight">
                {container.container_number}
              </span>
              <span className="font-mono text-xs font-semibold text-muted">
                {container.arrival_type || 'CONTAINER'}
              </span>
              {container.dock_door && (
                <span className="font-mono text-xs font-semibold text-muted">
                  Door {container.dock_door}
                </span>
              )}
              {/* Phase 21 (Amendment 9): blind counting removed — every
                  count is guided, so there is no mode badge anymore.
                  Phase 28: status is a coloured word, not a badge. */}
              <span
                className={`text-xs font-bold ${
                  container.status === 'completed'
                    ? 'text-positive'
                    : container.status === 'paused'
                    ? 'text-warning'
                    : 'text-accent'
                }`}
              >
                {container.status.toUpperCase()}
              </span>
              {container.status === 'paused' && container.pause_reason && (
                <span className="text-[11px] font-mono font-semibold text-warning">
                  {container.pause_reason}
                </span>
              )}
              {container.shortage_disposition && (
                <span className="text-[10px] font-mono font-bold text-warning">
                  Shortage: {container.shortage_disposition}
                </span>
              )}
            </div>
            <div className="truncate text-xs text-muted font-mono mt-0.5 [&>span]:inline">
              <span className="whitespace-nowrap">Consignment: {consignment?.consignment_ref || container.document_ref}</span>
              <span> · </span>
              <span className="whitespace-nowrap">Shipper: {container.supplier_name || 'Standard Inbound'}</span>
              {container.document_ref && (
                <>
                  <span> · </span>
                  <span className="whitespace-nowrap">Ref: {container.document_ref}</span>
                </>
              )}
              <span> · </span>
              <span className="inline">
                <Users className="inline w-3 h-3 text-muted mr-1" />
                Active Operators: <strong className="truncate text-ink">{activeOperators.join(', ')}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex shrink-0 items-center gap-1">
          <div className="hidden min-[720px]:block counting-unit">{unitSwitcher}</div>
          {/* Sync status — Phase 6: tells the truth. Queued tallies are
              on this device only until the server accepts them. Phase 28:
              a text line with a dot, not a pill. */}
          {failedCount > 0 ? (
            <div className="flex items-center gap-1.5 text-danger text-xs font-mono font-semibold" title={lastError || undefined}>
              <span className="w-2 h-2 rounded-full bg-danger" />
              <span>{failedCount} tallies failed to sync</span>
              <button type="button" onClick={() => void flushQueue()} disabled={isSyncing} className="underline font-bold disabled:opacity-50">
                {isSyncing ? 'Syncing…' : 'Retry'}
              </button>
            </div>
          ) : pendingCount > 0 ? (
            <div className="flex items-center gap-1.5 text-warning text-xs font-mono font-semibold">
              <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
              <span>{pendingCount} {pendingCount === 1 ? 'tally' : 'tallies'} queued on this device — not yet synced</span>
            </div>
          ) : (
            <div className="hidden sm:flex items-center gap-1.5 whitespace-nowrap text-secondary text-xs font-mono font-medium">
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-positive' : 'bg-warning'}`} />
              <span>{isOnline ? 'All counts saved' : 'Offline — tallies will queue on this device'}</span>
            </div>
          )}

          {/* Phase 21 (Amendment 8): everything not needed on every count
              sits behind this one menu — Pause/Resume, Complete, GRN,
              print slip. The sync pill above stays: it's status, not an
              action. */}
          <div className="relative">
            <Button
              size="md"
              variant="outline"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-label="More options"
              className="px-2 text-xs font-bold whitespace-nowrap"
            >
              <MoreHorizontal className="w-4 h-4 mr-1" strokeWidth={1.75} />
              <span className="max-[399px]:hidden">More options</span>
            </Button>
            {moreOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-60 bg-white border border-edge rounded-control shadow-lg z-30 py-1.5">
                <div className="sm:hidden px-3 py-2 border-b border-line"><div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xl font-bold text-ink tracking-tight">
                {container.container_number}
              </span>
              <span className="font-mono text-xs font-semibold text-muted">
                {container.arrival_type || 'CONTAINER'}
              </span>
              {container.dock_door && (
                <span className="font-mono text-xs font-semibold text-muted">
                  Door {container.dock_door}
                </span>
              )}
              {/* Phase 21 (Amendment 9): blind counting removed — every
                  count is guided, so there is no mode badge anymore.
                  Phase 28: status is a coloured word, not a badge. */}
              <span
                className={`text-xs font-bold ${
                  container.status === 'completed'
                    ? 'text-positive'
                    : container.status === 'paused'
                    ? 'text-warning'
                    : 'text-accent'
                }`}
              >
                {container.status.toUpperCase()}
              </span>
              {container.status === 'paused' && container.pause_reason && (
                <span className="text-[11px] font-mono font-semibold text-warning">
                  {container.pause_reason}
                </span>
              )}
              {container.shortage_disposition && (
                <span className="text-[10px] font-mono font-bold text-warning">
                  Shortage: {container.shortage_disposition}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted font-mono mt-0.5 flex-wrap">
              <span>Shipper: {container.supplier_name || 'Standard Inbound'}</span>
              {container.document_ref && (
                <>
                  <span> · </span>
                  <span>Ref: {container.document_ref}</span>
                </>
              )}
              <span> · </span>
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3 text-muted" />
                Active Operators: <strong className="text-ink">{activeOperators.join(', ')}</strong>
              </span>
            </div>
          </div></div>
                {container.status === 'paused' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      void changePauseStatus(false);
                    }}
                    disabled={isUpdatingStatus}
                    className="w-full text-left px-3.5 py-2.5 min-h-[48px] text-sm font-semibold text-ink hover:bg-soft disabled:opacity-50 flex items-center gap-2"
                  >
                    <Play className="w-4 h-4 text-positive" strokeWidth={1.75} />
                    Resume Unloading
                  </button>
                ) : container.status === 'active' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      setPauseModalOpen(true);
                    }}
                    disabled={isUpdatingStatus}
                    className="w-full text-left px-3.5 py-2.5 min-h-[48px] text-sm font-semibold text-ink hover:bg-soft disabled:opacity-50 flex items-center gap-2"
                  >
                    <Pause className="w-4 h-4 text-warning" strokeWidth={1.75} />
                    Pause Unloading
                  </button>
                ) : null}
                {isMaster && container.status !== 'completed' && (
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      void handleInitiateCompletion().catch((err) => alert(rpcErrorMessage(err)));
                    }}
                    disabled={isUpdatingStatus}
                    className="w-full text-left px-3.5 py-2.5 min-h-[48px] text-sm font-semibold text-ink hover:bg-soft disabled:opacity-50 flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4 text-positive" strokeWidth={1.75} />
                    Complete Receiving
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    setIsGrnModalOpen(true);
                  }}
                  className="w-full text-left px-3.5 py-2.5 min-h-[48px] text-sm font-semibold text-ink hover:bg-soft flex items-center gap-2"
                >
                  <FileSpreadsheet className="w-4 h-4 text-secondary" strokeWidth={1.75} />
                  Goods Received Note (GRN)
                </button>
                {container.status !== 'completed' && (
                  <Link
                    href={`/workbench/${containerId}/organise`}
                    onClick={() => setMoreOpen(false)}
                    className="w-full text-left px-3.5 py-2.5 min-h-[48px] text-sm font-semibold text-ink hover:bg-soft flex items-center gap-2"
                  >
                    <Layers className="w-4 h-4 text-secondary" strokeWidth={1.75} />
                    Organise Pallets (Merge)
                  </Link>
                )}
                {targetPallet && (
                  <a
                    href={`/print/pallet/${targetPallet.id}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setMoreOpen(false)}
                    className="w-full text-left px-3.5 py-2.5 min-h-[48px] text-sm font-semibold text-ink hover:bg-soft flex items-center gap-2"
                  >
                    <Printer className="w-4 h-4 text-secondary" strokeWidth={1.75} />
                    Print slip for {targetPallet.pallet_code}
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Keep the pad mounted while the phone manifest is open to preserve the draft tally. */}
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden bg-canvas">
        <div className="flex flex-1 flex-col min-h-0 min-[720px]:flex-row">
        <div
          className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden min-[720px]:order-2 min-[720px]:basis-0 ${
            mobileListOpen ? 'max-[719px]:hidden' : !selectedItemId ? 'max-[719px]:max-h-[60%]' : ''
          }`}
        >
        {/* Pallet strip (Phase 21, Amendment 8: the print-slip link lives
            in the header's More options menu.) */}
        <PalletManifestSelector
          pallets={pallets}
          selectedPalletId={selectedPalletId}
          onSelectPallet={(pid) => setSelectedPalletId(pid)}
          onCreatePallet={handleCreatePallet}
          onToggleSealPallet={handleToggleSealPallet}
          palletUnitsMap={palletUnitsMap}
          disabled={container.status === 'completed'}
        />

          {/* Zone 1: Tally Pad (counting band) */}
          <PalletTallyPad
          key={containerId}
          aliasMap={aliasMap}
          selectedItem={selectedItem}
          items={items}
          targetPallet={targetPallet}
          countedForSelectedSku={countedForSelectedSku}
          arrivalType={container.arrival_type}
          onPostTally={handlePostTally}
          onSelectItem={(it) => setSelectedItemId(it.id)}
          locations={locationsForSelected}
          pallets={pallets}
          onTransfer={handleTransfer}
          disabled={container.status === 'completed'}
        />


        </div>

        {mobileListOpen && selectedItemId && (
          <button
            type="button"
            onClick={() => setMobileListOpen(false)}
            className="hidden max-[719px]:flex shrink-0 items-center justify-center gap-1.5 min-h-12 border-b border-line bg-white px-3 text-sm font-semibold text-accent"
          >
            <ChevronUp className="w-4 h-4" strokeWidth={2} />
            Back to counting
          </button>
        )}

        <div
          className={`counting-products flex flex-col flex-1 min-h-0 overflow-x-hidden overflow-y-auto min-[720px]:order-1 min-[720px]:flex-none min-[720px]:w-[300px] min-[900px]:w-[340px] min-[1200px]:w-[400px] min-[720px]:min-h-0 min-[720px]:border-r min-[720px]:border-line ${
            mobileCountingFocus
              ? 'max-[719px]:flex-none max-[719px]:h-[3.375rem] max-[719px]:min-h-0 max-[719px]:overflow-hidden'
              : ''
          }`}
        >
          <SkuManifestSidebar
            aliasMap={aliasMap}
            items={items}
            selectedItemId={selectedItemId}
            onSelectItem={(it) => {
              setSelectedItemId(it.id);
              setMobileListOpen(false);
            }}
            collapsed={mobileCountingFocus}
            onExpandList={() => setMobileListOpen(true)}
            skuProgressMap={skuProgressMap}
            onAddUnlistedSku={handleAddUnlistedSku}
            isBlindMode={false}
            disabled={container.status === 'completed'}
          />

          <PalletLedgerTable
            entries={entries}
            itemsMap={itemsMap}
            palletsMap={palletsMap}
            palletsList={pallets}
            selectedItemId={selectedItemId}
            canVoid={canVoid}
            onVoidEntry={handleVoidEntry}
            onMovePallet={handleMovePallet}
            photoUrlsByEntryId={photoUrlsByEntryId}
            disabled={container.status === 'completed'}
          />
        </div>
        </div>
      </div>

      {/* Pause Modal */}
      <Modal
        isOpen={pauseModalOpen}
        onClose={() => setPauseModalOpen(false)}
        title="Pause Container Receiving"
      >
        <div className="space-y-4">
          <p className="text-xs text-secondary">
            Pause container operations for shift handover, meal break, or dock closure. All pallet tallies and seal states remain saved and ready to resume.
          </p>

          <div>
            <label className="block text-xs font-semibold text-secondary mb-1">
              Pause Status Note
            </label>
            <input
              type="text"
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-line rounded-lg focus:ring-2 focus:ring-warning focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPauseModalOpen(false)}
              disabled={isUpdatingStatus}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void changePauseStatus(true)}
              disabled={isUpdatingStatus || !pauseReason.trim()}
            >
              {isUpdatingStatus ? 'Saving...' : 'Confirm Pause'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Split Delivery vs True Supplier Shortage Disposition Modal */}
      {shortageModalOpen && (
        <Modal
          isOpen={shortageModalOpen}
          onClose={() => setShortageModalOpen(false)}
          title={finalizeHasShortages ? 'Incomplete Manifest Shortage Classification' : 'Complete Receiving — Sign-off'}
          size="md"
        >
          <div className="space-y-4">
            {finalizeHasShortages ? (
              <>
            <div className="p-3 bg-attention border border-attention rounded-lg text-xs space-y-1">
              <p className="font-bold text-warning flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-warning" strokeWidth={1.75} />
                Unreceived Stock Detected
              </p>
              <p className="text-secondary">
                One or more products in this container have counted quantities below the manifest expectation. Before closing this container, classify the disposition for industrial ERP reconciliation:
              </p>
            </div>

            <div className="space-y-2">
              <label
                onClick={() => setShortageDisposition('SPLIT_DELIVERY')}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  shortageDisposition === 'SPLIT_DELIVERY'
                    ? 'border-accent bg-selection/70 shadow-xs ring-1 ring-accent'
                    : 'border-line hover:bg-soft'
                }`}
              >
                <input
                  type="radio"
                  name="shortage_disposition"
                  checked={shortageDisposition === 'SPLIT_DELIVERY'}
                  onChange={() => setShortageDisposition('SPLIT_DELIVERY')}
                  className="mt-0.5 text-accent"
                />
                <div>
                  <div className="text-xs font-bold text-ink">
                    Split Delivery / Backordered in Subsequent Container
                  </div>
                  <p className="text-[11px] text-secondary mt-0.5">
                    Remaining cartons are expected in a later shipment or companion container. Keeps backorder open without initiating vendor claim.
                  </p>
                </div>
              </label>

              <label
                onClick={() => setShortageDisposition('TRUE_SHORTAGE')}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  shortageDisposition === 'TRUE_SHORTAGE'
                    ? 'border-danger bg-damage/70 shadow-xs ring-1 ring-danger'
                    : 'border-line hover:bg-soft'
                }`}
              >
                <input
                  type="radio"
                  name="shortage_disposition"
                  checked={shortageDisposition === 'TRUE_SHORTAGE'}
                  onChange={() => setShortageDisposition('TRUE_SHORTAGE')}
                  className="mt-0.5 text-danger"
                />
                <div>
                  <div className="text-xs font-bold text-ink">
                    True Supplier Shortage (Factory Packing Discrepancy)
                  </div>
                  <p className="text-[11px] text-secondary mt-0.5">
                    Container was completely emptied with zero remaining cartons. Flags official discrepancy for accounting credit note claim.
                  </p>
                </div>
              </label>

              <label
                onClick={() => setShortageDisposition('PENDING_INVESTIGATION')}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  shortageDisposition === 'PENDING_INVESTIGATION'
                    ? 'border-warning bg-attention/70 shadow-xs ring-1 ring-warning'
                    : 'border-line hover:bg-soft'
                }`}
              >
                <input
                  type="radio"
                  name="shortage_disposition"
                  checked={shortageDisposition === 'PENDING_INVESTIGATION'}
                  onChange={() => setShortageDisposition('PENDING_INVESTIGATION')}
                  className="mt-0.5 text-warning"
                />
                <div>
                  <div className="text-xs font-bold text-ink">
                    Pending Floor Search &amp; Dock Investigation
                  </div>
                  <p className="text-[11px] text-secondary mt-0.5">
                    Requires supervisor audit of floor staging lanes before issuing final supplier dispute.
                  </p>
                </div>
              </label>
            </div>

              </>
            ) : (
              <p className="text-xs text-secondary">
                All products are fully received or exceeded. Add the sign-off names below to close this container.
              </p>
            )}

            {/* Phase 23: digital sign-off — both names required, date automatic */}
            <div className="space-y-3 border-t border-line pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-secondary mb-1">
                    Received by <span className="text-danger">*</span>
                  </label>
                  <input
                    type="text"
                    value={receivedByName}
                    onChange={(e) => setReceivedByName(e.target.value)}
                    placeholder="Who received the goods"
                    className="w-full px-3 py-2 text-xs border border-line rounded focus:ring-1 focus:ring-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-secondary mb-1">
                    Checked by <span className="text-danger">*</span>
                  </label>
                  <input
                    type="text"
                    value={checkedByName}
                    onChange={(e) => setCheckedByName(e.target.value)}
                    placeholder="Who checked the count"
                    className="w-full px-3 py-2 text-xs border border-line rounded focus:ring-1 focus:ring-accent focus:outline-none"
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted">
                Date:{' '}
                <b>
                  {new Intl.DateTimeFormat('en-NZ', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    timeZone: 'Pacific/Auckland',
                  }).format(new Date())}
                </b>{' '}
                — filled automatically. Both names are required: this container cannot be closed until they are on the record.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShortageModalOpen(false)}
                disabled={isUpdatingStatus}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() =>
                  executeFinalizeContainer(
                    finalizeHasShortages ? shortageDisposition : null,

                    receivedByName,
                    checkedByName
                  )
                }
                disabled={isUpdatingStatus || !receivedByName.trim() || !checkedByName.trim()}
                className="bg-ink hover:bg-ink font-bold"
              >
                {isUpdatingStatus
                  ? 'Finalizing...'
                  : finalizeHasShortages
                    ? 'Confirm Disposition & Close'
                    : 'Confirm & Close Container'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Official GRN Reconciliation Modal */}
      <GrnReconciliationModal
        isOpen={isGrnModalOpen}
        onClose={() => setIsGrnModalOpen(false)}
        container={container}
        items={items}
        pallets={pallets}
        entries={entries}
      />
    </div>
  );
}
