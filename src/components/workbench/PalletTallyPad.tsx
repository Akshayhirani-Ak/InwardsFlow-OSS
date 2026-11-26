'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  ArrivalType,
  ExpectedItem,
  Pallet,
  PackOverrideReason,
  QcReasonCode,
  QcStatus,
} from '@/types/wms';
import {
  Plus,
  Minus,
  ChevronDown,
  AlertTriangle,
  PackageOpen,
  ShieldAlert,
  CornerDownLeft,
  Zap,
  ScanBarcode,
  Undo2,
  MapPin,
  X,
  Camera,
} from 'lucide-react';
import {
  accumulateScans,
  normalizeScanCode,
  resolveScanItem,
  scanUnits,
  scannedItemOrder,
  type ScanLogEntry,
} from '@/lib/workbench/scan';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { rpcErrorMessage } from '@/lib/utils/errors';

// Phase 21 (Amendment 6): where the selected product physically sits —
// one row per pallet, entries listed so a transfer can consume them FIFO.
export interface PalletLocationRow {
  palletId: string;
  palletCode: string;
  palletStatus: 'open' | 'sealed';
  boxes: number;
  goodQty: number;
  entries: { id: string; cartons: number; goodQty: number; pack: number }[];
}

export interface TransferArgs {
  fromPalletId: string;
  boxes: number;
  toPalletId: string | 'NEW';
}

interface PalletTallyPadProps {
  aliasMap?: Record<string, string>;
  selectedItem: ExpectedItem | null;
  /** All manifest items on the container — scans resolve against the
   * whole list (product code, line supplier code, alias map). */
  items?: ExpectedItem[];
  targetPallet: Pallet | null;
  countedForSelectedSku: number;
  arrivalType?: ArrivalType;
  onPostTally: (data: {
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
  }) => Promise<'posted' | 'queued' | void>;
  /** Phase 21: scan-first — a first scan selects its product. */
  onSelectItem?: (item: ExpectedItem) => void;
  /** Phase 21 (Amendment 6): pallet locations of the selected product. */
  locations?: PalletLocationRow[];
  /** All pallets on the container — transfer destinations. */
  pallets?: Pallet[];
  onTransfer?: (args: TransferArgs) => Promise<void>;
  disabled?: boolean;
}

// One numeric field style for the whole pad — a thumb stepper either side
// of a centred input (Phase 20, kept). Phase 28 (Ledger): the Full Boxes
// stepper is the hero control — 64px keys and a 56px count, the biggest
// type on the screen after the product code.
interface StepperInputProps {
  label: string;
  labelShort?: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  disabled?: boolean;
  hero?: boolean;
}

const StepperInput: React.FC<StepperInputProps> = ({
  label,
  labelShort,
  value,
  onChange,
  min = 0,
  disabled = false,
  hero = false,
}) => {
  const step = (delta: number) => {
    const current = parseInt(value, 10) || 0;
    onChange(String(Math.max(min, current + delta)));
  };
  const btn = hero
    ? 'w-12 min-h-[52px] flex items-center justify-center bg-white border border-edge text-ink hover:bg-soft active:bg-soft disabled:opacity-40 transition-colors'
    : 'w-12 min-h-[48px] flex items-center justify-center bg-white border border-edge text-ink hover:bg-soft active:bg-soft disabled:opacity-40 transition-colors';
  return (
    // max-w-xl (his call, 23 Nov 2026): on wide tablet/desktop screens the
    // stepper must not stretch the full column — a number box 800px wide
    // reads as a giant empty field. Phones are narrower than the cap, so
    // nothing changes there.
    <div className="max-w-xl">
      <label className="block text-xs font-semibold text-secondary mb-1">
        {labelShort ? (
          <>
            <span className="sm:hidden">{labelShort}</span>
            <span className="hidden sm:inline">{label}</span>
          </>
        ) : (
          label
        )}
      </label>
      <div className="flex items-stretch gap-1.5">
        <button type="button" aria-label={`Decrease ${label}`} onClick={() => step(-1)} disabled={disabled} className={`${btn} rounded-l-control`}>
          <Minus className={hero ? 'w-5 h-5' : 'w-4 h-4'} strokeWidth={2} />
        </button>
        <input
          type="number"
          min={min}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onWheel={(e) => e.currentTarget.blur()}
          disabled={disabled}
          className={
            hero
              ? 'flex-1 min-w-0 px-2 py-1 min-h-[52px] tabular-nums text-[30px] leading-none font-bold text-center bg-white border border-edge focus:ring-1 focus:ring-accent focus:outline-none'
              : 'flex-1 min-w-0 px-2 py-1.5 min-h-[48px] font-mono tabular-nums text-base font-bold text-center bg-white border border-edge focus:ring-1 focus:ring-accent focus:outline-none'
          }
        />
        <button type="button" aria-label={`Increase ${label}`} onClick={() => step(1)} disabled={disabled} className={`${btn} rounded-r-control`}>
          <Plus className={hero ? 'w-5 h-5' : 'w-4 h-4'} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
};

// Phase 21 (Amendment 6): one pallet row of the location view, with its
// own transfer control. A transfer is just −boxes here, +boxes there.
const LocationRowView: React.FC<{
  row: PalletLocationRow;
  pallets: Pallet[];
  disabled?: boolean;
  onTransfer?: (args: TransferArgs) => Promise<void>;
}> = ({ row, pallets, disabled = false, onTransfer }) => {
  const [qty, setQty] = useState('1');
  const [dest, setDest] = useState<string>('NEW');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const destinations = pallets.filter(
    (p) => p.id !== row.palletId && p.status === 'open'
  );
  const boxes = Math.max(0, parseInt(qty, 10) || 0);

  const go = async () => {
    if (!onTransfer || boxes < 1) return;
    setBusy(true);
    setMsg('');
    try {
      await onTransfer({
        fromPalletId: row.palletId,
        boxes,
        toPalletId: dest as string | 'NEW',
      });
      setMsg('Moved.');
    } catch (err: unknown) {
      setMsg(rpcErrorMessage(err, 'Transfer failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-2 border-b border-line last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-bold text-ink text-[13px]">
          {row.palletCode}
        </span>
        <span className="font-mono tabular-nums text-sm text-ink">
          {row.boxes} boxes · {row.goodQty.toLocaleString()} pcs
        </span>
      </div>
      {onTransfer && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <input
            type="number"
            min={1}
            max={row.boxes}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onWheel={(e) => e.currentTarget.blur()}
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
            disabled={disabled || busy}
            aria-label={`Boxes to move from ${row.palletCode}`}
            className="w-20 px-2 py-2 min-h-[48px] font-mono tabular-nums text-base font-bold text-center bg-white border border-edge rounded-control focus:ring-1 focus:ring-accent focus:outline-none"
          />
          <span className="text-xs font-semibold text-secondary">boxes →</span>
          <select
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            disabled={disabled || busy}
            aria-label="Destination pallet"
            className="flex-1 min-w-[130px] px-2 py-2 min-h-[48px] text-sm font-semibold bg-white border border-edge rounded-control focus:ring-1 focus:ring-accent focus:outline-none"
          >
            <option value="NEW">New pallet</option>
            {destinations.map((p) => (
              <option key={p.id} value={p.id}>
                {p.pallet_code}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={go}
            disabled={disabled || busy || boxes < 1 || boxes > row.boxes}
            className="min-h-[48px] font-bold"
          >
            {busy ? 'Moving…' : 'Move'}
          </Button>
        </div>
      )}
      {msg && <p className="text-[11px] font-semibold text-secondary mt-1">{msg}</p>}
    </div>
  );
};

export const PalletTallyPad: React.FC<PalletTallyPadProps> = ({
  aliasMap = {},
  selectedItem,
  items = [],
  targetPallet,
  countedForSelectedSku,
  arrivalType = 'CONTAINER',
  onPostTally,
  onSelectItem,
  locations,
  pallets = [],
  onTransfer,
  disabled = false,
}) => {
  // Phase 21: ONE counting screen (Amendment 3) — no modes, no tabs.
  // Boxes counted by hand (stepper / typed / multiplied) plus boxes
  // counted by scanning accumulate into the same Record.
  const [cartonsInput, setCartonsInput] = useState<string>('1');
  const [partialPcsInput, setPartialPcsInput] = useState<string>('0');
  const [packSizeInput, setPackSizeInput] = useState<string>('1');
  const [damagedQtyInput, setDamagedQtyInput] = useState<string>('0');
  // True once the operator touches a manual field after selecting the
  // product — decides whether Record also posts the manual quantities
  // alongside any scanned boxes.
  const [manualDirty, setManualDirty] = useState(false);

  // QC state
  const [qcStatus, setQcStatus] = useState<QcStatus>('PASS');
  const [qcReasonCode, setQcReasonCode] = useState<QcReasonCode | string>('PASS');
  const [qcRemarks, setQcRemarks] = useState<string>('');
  const [photoFiles, setPhotoFiles] = useState<File[]>([]); // Phase 8: damage evidence
  // Phase 22 hunt fix: a set of damage photos is evidence for ONE tally
  // entry. Without this latch, a Record that posts both hand-counted and
  // scanned damage attached the same photos to two entries.
  const photosAttachedRef = useRef(false);
  // Phase 37b: pack answers remembered per expected item for the life
  // of this counting session (see the variance check in handleSubmit).
  const confirmedPackRef = useRef(
    new Map<string, { pack: number; reason: PackOverrideReason }>(),
  );

  // Scan state (Phase 12, kept): the log is the source of truth — one
  // entry per scanned box; accumulation is derived. Scans are local
  // until Record.
  const [scanInput, setScanInput] = useState('');
  const [scanLog, setScanLog] = useState<ScanLogEntry[]>([]);
  const [damagedNext, setDamagedNext] = useState(false);
  // Amendment 4: a scan that is not the selected product's code.
  const [wrongCode, setWrongCode] = useState<{
    code: string;
    productName: string | null;
    productCode: string | null;
  } | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const [locationsOpen, setLocationsOpen] = useState(false);


  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [debounceNotice, setDebounceNotice] = useState('');

  // 150% Overcount confirmation modal
  const [showOvercountModal, setShowOvercountModal] = useState(false);
  const [pendingTallyPayload, setPendingTallyPayload] = useState<{
    cartons: number;
    pack: number;
    good: number;
    damaged: number;
    partialQty: number;
    overrideReason?: PackOverrideReason | null;
  } | null>(null);

  // 3-Way Pack Size Override & Half-Box Modal
  const [showPackOverrideModal, setShowPackOverrideModal] = useState(false);
  const [selectedOverrideReason, setSelectedOverrideReason] =
    useState<PackOverrideReason>('PARTIAL_HALF_BOX');

  const tallyItemId = useRef<string | null>(null);
  // Auto-sync inputs when the selected product changes
  useEffect(() => {
    if (tallyItemId.current === (selectedItem?.id ?? null)) return;
    tallyItemId.current = selectedItem?.id ?? null;
    if (selectedItem) {
      const ps = confirmedPackRef.current.get(selectedItem.sku_code)?.pack || selectedItem.pack_size || 1;
      setPackSizeInput(ps.toString());
      setCartonsInput('1');
      setPartialPcsInput(
        selectedItem.partial_cartons && selectedItem.expected_partial_qty
          ? selectedItem.expected_partial_qty.toString()
          : '0'
      );
      // Phase 37c: re-collapse the partial control per product (a
      // manifest partial on the new product reopens it via its value).
      setPartialOpen(false);
      setDamagedQtyInput('0');
      setQcStatus('PASS');
      setQcReasonCode('PASS');
      setQcRemarks('');
      setErrorMessage('');
      setDebounceNotice('');
      setWrongCode(null);
      setManualDirty(false);
      setLocationsOpen(false);
      setDamageOpen(false);
      // Phase 22 hunt fix: photos belong to the product they were taken
      // for — never carry them across a product switch.
      setPhotoFiles([]);
      photosAttachedRef.current = false;
    }
  }, [selectedItem]);

  // Derived quantities — one model for the whole screen.
  const packSize = parseInt(packSizeInput, 10) || 1;
  const cartons = parseInt(cartonsInput, 10) || 0;
  const partialPcs = parseInt(partialPcsInput, 10) || 0;
  const damaged = parseInt(damagedQtyInput, 10) || 0;

  const scanAcc = accumulateScans(scanLog);
  const packForItem = (item: ExpectedItem): number => item.pack_size || 1;
  const scanTotalsAll = scannedItemOrder(scanLog).reduce(
    (sum, itemId) => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return sum;
      const u = scanUnits(scanAcc[itemId], packForItem(item));
      return {
        cartons: sum.cartons + u.cartons,
        good: sum.good + u.goodQty,
        damaged: sum.damaged + u.damagedQty,
      };
    },
    { cartons: 0, good: 0, damaged: 0 }
  );
  const scanDamagedUnits = scanTotalsAll.damaged;
  const effectiveDamaged = damaged + scanDamagedUnits;

  // Phase 33 (his ruling, 21 Nov 2026): damage is a rare event — the
  // Damage & QC section stays hidden behind one row until the operator
  // opens it or damage exists on this record. (Supersedes Phase 21
  // Amendment 2, which kept the section always visible.)
  const [damageOpen, setDamageOpen] = useState(false);
  const showDamage = damageOpen || effectiveDamaged > 0;
  // Phase 37c: the partial box is a rare event too — same treatment as
  // Damage & QC. Collapsed to one line by default so Pcs per Box gets
  // the full row; it stays open while a partial quantity exists.
  const [partialOpen, setPartialOpen] = useState(false);
  const showPartial = partialOpen || partialPcs > 0;

  const scannedGoodBoxesSelected = selectedItem
    ? scanAcc[selectedItem.id]?.goodCartons ?? 0
    : 0;
  const totalBoxesSelected = cartons + scannedGoodBoxesSelected;
  // The total bar describes the SELECTED product: its hand-counted
  // quantities plus its own scanned boxes (the session line in the scan
  // panel still shows the whole session).
  const scanSelUnits = selectedItem
    ? scanUnits(
        scanAcc[selectedItem.id] ?? { goodCartons: 0, damagedCartons: 0 },
        packForItem(selectedItem)
      )
    : { cartons: 0, goodQty: 0, damagedQty: 0 };

  // Manual quantities: damaged units come OUT of the handled total (the
  // 2026-10-24 hotfix semantics, unchanged).
  const manualHandled = cartons * packSize + partialPcs;
  const manualGood = Math.max(0, manualHandled - damaged);
  const effectiveCartons = cartons + (partialPcs > 0 ? 1 : 0);

  // What the total bar and Record button describe for this product:
  // manual quantities + this product's scanned boxes.
  const displayGood = manualGood + scanSelUnits.goodQty;
  const displayDamaged = damaged + scanSelUnits.damagedQty;

  const touch = () => setManualDirty(true);

  // Amendment 3: see 10 boxes together — scan one, multiply the count.
  // The chips act on the product's TOTAL boxes (hand-counted + scanned);
  // the hand-counted portion is what adjusts.
  const applyMultiply = (n: number) => {
    const target = totalBoxesSelected > 0 ? totalBoxesSelected * n : n;
    setCartonsInput(String(Math.max(0, target - scannedGoodBoxesSelected)));
    touch();
  };
  const quickAdd = (n: number) => {
    setCartonsInput(String(cartons + n));
    touch();
  };

  // ---- Scanning ------------------------------------------------------------
  // Amendment 7: NO wait between scans — a scan is accepted the moment it
  // lands, 4–5 in a second all count. (The old 3-second anti-bounce guard
  // on Record is gone too; the in-flight submit state is the only block.)
  // Amendment 4: while a product is selected, a scan counts ONLY if it is
  // that product's code. A different code — same-looking box, different
  // product — is rejected with the red Wrong code line and never counted.
  const doScan = (raw: string) => {
    const item = resolveScanItem(items, aliasMap, raw);
    if (!item) {
      setWrongCode({ code: normalizeScanCode(raw), productName: null, productCode: null });
      setScanInput('');
      requestAnimationFrame(() => scanInputRef.current?.focus());
      return;
    }
    if (selectedItem && item.id !== selectedItem.id) {
      setWrongCode({
        code: normalizeScanCode(raw),
        productName: item.product_name,
        productCode: item.sku_code,
      });
      setScanInput('');
      requestAnimationFrame(() => scanInputRef.current?.focus());
      return;
    }
    setWrongCode(null);
    if (!selectedItem && onSelectItem) {
      onSelectItem(item);
    }
    setScanLog((prev) => [...prev, { itemId: item.id, damaged: damagedNext }]);
    setScanInput('');
    requestAnimationFrame(() => scanInputRef.current?.focus());
  };

  const handleRecordScans = async () => {
    if (!targetPallet || scanLog.length === 0) return;
    if (targetPallet.status === 'sealed') {
      setErrorMessage('Target pallet is sealed. Please unseal or choose an open pallet.');
      return;
    }
    if (scanDamagedUnits > 0 && qcReasonCode === 'PASS') {
      setErrorMessage('Damaged boxes scanned — select a QC reason code below before recording.');
      return;
    }
    // Phase 22 hunt fix: snapshot the log. Scans that land WHILE this
    // post is in flight are appended after the snapshot (Undo/Clear are
    // disabled during submit, so the log only grows) — clearing the
    // whole log on success silently ate those boxes.
    const snapshotLength = scanLog.length;
    const order = scannedItemOrder(scanLog);
    const postedIds: string[] = [];
    let sawQueued = false;
    try {
      setIsSubmitting(true);
      setErrorMessage('');
      setDebounceNotice('');
      for (const itemId of order) {
        const item = items.find((i) => i.id === itemId);
        if (!item) continue;
        const u = scanUnits(scanAcc[itemId], packForItem(item));
        // Phase 22 hunt fix: photos attach to the FIRST damaged entry
        // only — never duplicated onto every damaged item in the loop.
        const attachPhotos =
          u.damagedQty > 0 && photoFiles.length > 0 && !photosAttachedRef.current
            ? photoFiles
            : undefined;
        const outcome = await onPostTally({
          itemId: item.id,
          cartonsCounted: u.cartons,
          packSizeUsed: packForItem(item),
          goodQty: u.goodQty,
          damagedQty: u.damagedQty,
          qcStatus: u.damagedQty > 0 ? qcStatus : 'PASS',
          qcReasonCode: u.damagedQty > 0 ? qcReasonCode : 'PASS',
          qcRemarks: qcRemarks.trim() || undefined,
          photoFiles: attachPhotos,
        });
        if (attachPhotos) photosAttachedRef.current = true;
        if (outcome === 'queued') sawQueued = true;
        postedIds.push(itemId);
      }
      // Full success: drop only the snapshot's scans; anything scanned
      // during the post stays in the session for the next Record.
      setScanLog((prev) => prev.slice(snapshotLength));
      setPhotoFiles([]);
      setDamagedQtyInput('0');
      setQcStatus('PASS');
      setQcReasonCode('PASS');
      setQcRemarks('');
      setDamagedNext(false);
      setDamageOpen(false);
      if (sawQueued) {
        setDebounceNotice(
          'Offline — scan tallies saved on this device. They will sync when the connection returns.'
        );
      } else if (scanDamagedUnits > 0) {
      } else {
      }
      requestAnimationFrame(() => scanInputRef.current?.focus());
    } catch (err: unknown) {
      // Keep the scans that did NOT post so nothing is lost or doubled —
      // within the snapshot; scans appended during the post stay too.
      setScanLog((prev) => [
        ...prev.slice(0, snapshotLength).filter((e) => !postedIds.includes(e.itemId)),
        ...prev.slice(snapshotLength),
      ]);
      setErrorMessage(
        `Some scan tallies failed to post: ${rpcErrorMessage(err, 'Failed to post scans')}. The unposted scans are still listed above.`
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const executePostTally = async (payload: {
    cartons: number;
    pack: number;
    good: number;
    damaged: number;
    partialQty: number;
    overrideReason?: PackOverrideReason | null;
  }) => {
    try {
      setIsSubmitting(true);
      setErrorMessage('');
      setDebounceNotice('');

      // Phase 22 hunt fix: photos attach to ONE entry only (see
      // photosAttachedRef) — a following scan post must not re-attach.
      const attachPhotos =
        payload.damaged > 0 && photoFiles.length > 0 && !photosAttachedRef.current
          ? photoFiles
          : undefined;
      const outcome = await onPostTally({
        cartonsCounted: payload.cartons,
        packSizeUsed: payload.pack,
        goodQty: payload.good,
        damagedQty: payload.damaged,
        qcStatus: payload.damaged > 0 ? qcStatus : 'PASS',
        qcReasonCode: payload.damaged > 0 ? qcReasonCode : 'PASS',
        qcRemarks: qcRemarks.trim() || undefined,
        partialCartonQty: payload.partialQty > 0 ? payload.partialQty : undefined,
        packOverrideReason: payload.overrideReason || undefined,
        photoFiles: attachPhotos,
      });
      if (attachPhotos) photosAttachedRef.current = true;

      let notice = '';
      if (outcome === 'queued') {
        // Phase 6 — no fake success: a queued tally is on this device only.
        notice =
          'Offline — tally saved on this device. It will sync when the connection returns.';
      } else if (payload.damaged > 0) {
      } else {
      }
      // Phase 22 hunt fix: if this post came from a confirmation modal,
      // any scanned boxes are still waiting — say so (this function's
      // notice reset used to swallow that fact). In the direct flow the
      // scan post runs right after and replaces the notice with its own.
      if (scanLog.length > 0) {
        notice =
          (notice ? notice + ' ' : '') +
          'Scanned boxes are still waiting — tap Record Tally to post them.';
      }
      if (notice) setDebounceNotice(notice);

      // Reset for next count
      setCartonsInput('1');
      setPartialPcsInput('0');
      setPhotoFiles([]);
      photosAttachedRef.current = false;
      setDamagedQtyInput('0');
      setQcStatus('PASS');
      setQcReasonCode('PASS');
      setQcRemarks('');
      setManualDirty(false);
      setDamageOpen(false);
      // Phase 22 hunt fix: hand focus back to the scan field — a wedge
      // scanner typing into nowhere loses boxes silently.
      requestAnimationFrame(() => scanInputRef.current?.focus());
    } catch (err: unknown) {
      setErrorMessage(rpcErrorMessage(err, 'Failed to post tally entry.'));
    } finally {
      setIsSubmitting(false);
      setShowOvercountModal(false);
      setShowPackOverrideModal(false);
      setPendingTallyPayload(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !targetPallet) return;

    if (targetPallet.status === 'sealed') {
      setErrorMessage('Target pallet is sealed. Please unseal or choose an open pallet.');
      return;
    }

    const hasScans = scanLog.length > 0;
    const manualHasContent = manualGood > 0 || damaged > 0;
    const postManual = manualHasContent && (!hasScans || manualDirty);

    if (!postManual && !hasScans) {
      setErrorMessage('Please enter at least 1 Good or Damaged unit to record a tally.');
      return;
    }

    if (postManual) {
      if (damaged > 0 && qcReasonCode === 'PASS') {
        setErrorMessage('Please select an active QC reason code for damaged stock.');
        return;
      }

      const initialPayload = {
        cartons: effectiveCartons,
        pack: packSize,
        good: manualGood,
        damaged,
        partialQty: partialPcs,
        overrideReason: null as PackOverrideReason | null,
      };

      // Pack Size Variance Check OR Half-Box Detection.
      // Phase 37b: the question is per product, not per box. Once the
      // operator has answered it for this item at this pack, later
      // tallies for the same item at the same pack post directly with
      // the confirmed reason still attached to the entry — the modal
      // only returns for a different pack or a different product.
      const isPackVariance = packSize !== selectedItem.pack_size;
      const isHalfBox = partialPcs > 0;
      const confirmedPack = confirmedPackRef.current.get(selectedItem.sku_code);

      if ((isPackVariance || isHalfBox) && confirmedPack?.pack === packSize) {
        initialPayload.overrideReason = confirmedPack.reason;
      } else if (isPackVariance || isHalfBox) {
        setPendingTallyPayload(initialPayload);
        setSelectedOverrideReason(isHalfBox ? 'PARTIAL_HALF_BOX' : 'PACK_SIZE_CHANGED');
        setShowPackOverrideModal(true);
        if (hasScans) {
          setDebounceNotice(
            'Confirm the hand-counted boxes first — scanned boxes record right after.'
          );
        }
        return;
      }

      // 150% Overcount Guard
      const expectedQty = selectedItem.expected_total_qty;
      const totalAfter = countedForSelectedSku + manualGood + damaged;
      if (expectedQty > 0 && totalAfter > expectedQty * 1.5) {
        setPendingTallyPayload(initialPayload);
        setShowOvercountModal(true);
        if (hasScans) {
          setDebounceNotice(
            'Confirm the hand-counted boxes first — scanned boxes record right after.'
          );
        }
        return;
      }

      await executePostTally(initialPayload);
    }

    if (hasScans) {
      await handleRecordScans();
    }
  };

  // 1-Click Courier Bench Confirmation
  const handleCourierOneClickConfirm = async () => {
    if (!selectedItem || !targetPallet) return;
    const remainingToCount = Math.max(
      0,
      selectedItem.expected_total_qty - countedForSelectedSku
    );
    if (remainingToCount <= 0) {
      alert('This product is already 100% received.');
      return;
    }

    const payload = {
      cartons: selectedItem.expected_cartons,
      pack: selectedItem.pack_size,
      good: remainingToCount,
      damaged: 0,
      partialQty: selectedItem.expected_partial_qty || 0,
      overrideReason:
        selectedItem.partial_cartons && selectedItem.partial_cartons > 0
          ? ('PARTIAL_HALF_BOX' as PackOverrideReason)
          : null,
    };

    await executePostTally(payload);
  };

  // The scan field is shared by the no-selection prompt and the pad.
  const scanField = (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <ScanBarcode
          className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          strokeWidth={1.75}
        />
        <input
          ref={scanInputRef}
          type="text"
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (scanInput.trim()) doScan(scanInput);
            }
          }}
          placeholder="Scan product code"
          aria-label="Scan or type a product code"
          disabled={disabled}
          className="w-full pl-10 pr-3 py-1.5 min-h-[48px] font-mono tabular-nums text-base font-bold bg-white border border-edge rounded-control focus:ring-1 focus:ring-accent focus:outline-none"
        />
      </div>
      <button
        type="button"
        onClick={() => setDamagedNext((v) => !v)}
        aria-pressed={damagedNext}
        disabled={disabled}
        className={`px-3 py-1.5 min-h-[48px] rounded-control text-xs font-bold border transition-colors ${
          damagedNext
            ? 'bg-danger text-white border-danger'
            : 'bg-white text-secondary border-edge hover:bg-soft'
        }`}
      >
        Damaged: {damagedNext ? 'ON' : 'OFF'}
      </button>
    </div>
  );

  // Amendment 4: the red Wrong code line — stays until the next scan or
  // the operator dismisses it. Never counted, never silent.
  const wrongCodeBanner = wrongCode && (
    <div className="flex items-start gap-2 rounded-control border border-danger bg-damage px-3 py-2">
      <AlertTriangle className="w-5 h-5 text-danger shrink-0 mt-0.5" strokeWidth={2} />
      <div className="flex-1 text-sm">
        <span className="font-bold text-danger">Wrong code</span>
        <span className="text-danger">
          {' — '}
          {wrongCode.productName
            ? `that code is ${wrongCode.productName} (${wrongCode.productCode}), not the product you're counting. Put that box aside — it was NOT counted.`
            : `${wrongCode.code} is not on this container. That box was NOT counted.`}
        </span>
      </div>
      <button
        type="button"
        aria-label="Dismiss wrong code warning"
        onClick={() => setWrongCode(null)}
        className="text-danger hover:text-danger"
      >
        <X className="w-4 h-4" strokeWidth={2} />
      </button>
    </div>
  );

  if (!selectedItem) {
    return (
      <div className="counting-pad bg-white border-b border-line p-4 sm:p-6 space-y-3 flex-1 min-h-0 overflow-hidden max-lg:overflow-y-auto">
        <h3 className="text-sm font-semibold text-secondary flex items-center gap-2">
          <ScanBarcode className="w-4 h-4 text-muted" strokeWidth={1.75} />
          Scan a box to start counting
        </h3>
        {scanField}
        {wrongCodeBanner}
        <p className="text-xs text-muted">
          Or select a product from the manifest list. One scan = one box of
          that product.
        </p>
      </div>
    );
  }

  const expected = selectedItem.expected_total_qty;
  const remaining = Math.max(0, expected - countedForSelectedSku);
  const isPalletSealed = targetPallet?.status === 'sealed';
  const isCourier = arrivalType === 'COURIER_PARCEL';
  const totalLocationsBoxes = (locations || []).reduce((s, r) => s + r.boxes, 0);

  return (
    <div className="counting-pad bg-white border-b border-line px-2 py-2 sm:px-6 sm:py-2.5 flex-1 min-h-0 overflow-hidden flex flex-col">
      <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
        {/* Phase 32 (top/bottom layout, his ruling 21 Nov 2026):
            the scan row runs across the top of the band; below it the
            counting grid — product | boxes | damage + record — which
            stacks in the same order on small screens. */}
        <div className="shrink-0 lg:flex lg:items-start lg:gap-4">
          <div className="flex-1 min-w-0 space-y-3">
            {scanField}
            {scanLog.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-mono text-secondary">
                  Scanned this session: {scanTotalsAll.cartons} boxes —{' '}
                  {scanTotalsAll.good.toLocaleString()} good
                  {scanTotalsAll.damaged > 0
                    ? `, ${scanTotalsAll.damaged.toLocaleString()} damaged`
                    : ''}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setScanLog((prev) => prev.slice(0, -1))}
                    disabled={disabled || isSubmitting}
                    className="px-3 py-2 min-h-[48px] rounded-control text-xs font-bold bg-white text-secondary border border-edge hover:bg-soft disabled:opacity-40 flex items-center gap-1"
                  >
                    <Undo2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                    Undo last scan
                  </button>
                  <button
                    type="button"
                    onClick={() => setScanLog([])}
                    disabled={disabled || isSubmitting}
                    className="px-3 py-2 min-h-[48px] rounded-control text-xs font-bold bg-white text-secondary border border-edge hover:bg-soft disabled:opacity-40"
                  >
                    Clear
                  </button>
                </span>
              </div>
            )}
            <p className="sr-only">
              One scan = one box. Counting a stack instead? Set the box count
              below, or scan one box and multiply it.
            </p>
          </div>
          {wrongCodeBanner ? (
            <div className="mt-3 lg:mt-0 lg:w-[400px] lg:shrink-0">{wrongCodeBanner}</div>
          ) : null}
        </div>

        <div className="counting-controls flex flex-col mt-1 space-y-1 min-[720px]:max-lg:grid min-[720px]:max-lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-[720px]:max-lg:gap-x-2 min-[720px]:max-lg:space-y-0 lg:mt-2 lg:space-y-0 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.9fr)] flex-1 min-h-0 overflow-y-auto overflow-x-hidden min-[720px]:items-start">
          <div className="counting-identity shrink-0 min-[720px]:max-lg:col-span-2 lg:pr-2">
            {/* Product header — Amendment 1: boxes and pieces language,
                "1 box = N pcs" is the anchor fact for the line. Phase 28
                (Ledger): the code is the hero identifier — mono, never
                truncated; flags are plain coloured words, not badges. */}
            {/* One summary block (his call, 24 Nov 2026): identity and
                quantities read as a single unit — code, name and the
                Expected / Counted / Remaining figures together. On
                tablet the figures sit beside the identity in the same
                row; on phone and desktop they stack directly underneath
                inside the same block. */}
            <div className="min-[720px]:max-lg:flex min-[720px]:max-lg:items-center min-[720px]:max-lg:gap-5 min-[720px]:max-lg:border-b min-[720px]:max-lg:border-line min-[720px]:max-lg:pb-2">
            <div className="flex flex-wrap items-start justify-between gap-2 pb-2 min-[720px]:max-lg:flex-1 min-[720px]:max-lg:min-w-0 min-[720px]:max-lg:pb-0">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono tabular-nums text-[20px] leading-tight font-bold text-ink break-all">
                    {selectedItem.sku_code}
                  </span>
                  {selectedItem.is_priority && (
                    <span className="text-[11px] font-bold text-danger">PRIORITY</span>
                  )}
                  {selectedItem.is_unlisted_addition && (
                    <span className="text-[11px] font-bold text-warning">UNLISTED</span>
                  )}
                </div>
                {/* Below lg the name, pack and supplier code share ONE
                    line (his call, 24 Nov 2026 — every line is height on
                    a short screen); the name truncates first. Desktop's
                    narrow identity column keeps the supplier on its own
                    line underneath. */}
                <p className="text-sm font-medium text-secondary mt-0.5 max-lg:flex max-lg:items-baseline max-lg:min-w-0">
                  <span className="max-lg:truncate">{selectedItem.product_name}</span>
                  <span className="text-muted max-lg:shrink-0 max-lg:whitespace-nowrap"> · 1 box = {packSize} pcs</span>
                  {selectedItem.supplier_sku_code && (
                    <span className="lg:hidden min-w-0 truncate font-mono text-[11px] text-muted">
                      {' '}· Supplier: {selectedItem.supplier_sku_code}
                    </span>
                  )}
                </p>
                {selectedItem.supplier_sku_code && (
                  <p className="hidden lg:block text-[11px] font-mono text-muted">
                    Supplier code: {selectedItem.supplier_sku_code}
                  </p>
                )}
              </div>
              <div className="text-right text-[11px] font-mono text-muted">
                <div className="max-lg:hidden">
                  Target pallet:{' '}
                  <span className="font-bold text-ink">
                    {targetPallet ? targetPallet.pallet_code : '—'}
                  </span>
                </div>
                {isPalletSealed && (
                  <span className="font-bold text-danger">PALLET SEALED</span>
                )}
              </div>
            </div>
            {/* Progress strip — Expected / Counted / Remaining as a
                divided ledger band (24 Nov 2026): three equal cells,
                hairline dividers, instead of loose figures floating
                next to the product name. */}
            <div className="counting-quantities grid grid-cols-3 divide-x divide-line border-y border-line py-2 tabular-nums [&>div]:pl-3 [&>div:first-child]:pl-0 min-[720px]:max-lg:w-1/2 min-[720px]:max-lg:shrink-0 min-[720px]:max-lg:border-y-0 min-[720px]:max-lg:py-0">
              <div>
                <span className="block text-[11px] font-semibold text-muted">
                  Expected
                </span>
                <span className="text-lg font-bold text-ink">
                  {expected.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="block text-[11px] font-semibold text-muted">
                  Counted
                </span>
                <span className="text-lg font-bold text-ink">
                  {countedForSelectedSku.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="block text-[11px] font-semibold text-muted">
                  Remaining
                </span>
                <span
                  className={`text-lg font-bold ${
                    remaining > 0 ? 'text-warning' : 'text-positive'
                  }`}
                >
                  {remaining.toLocaleString()}
                </span>
              </div>
            </div>
            </div>
            {isCourier && remaining > 0 && (
              <button
                type="button"
                onClick={handleCourierOneClickConfirm}
                disabled={disabled || isSubmitting || isPalletSealed}
                className="w-full mb-4 px-3 py-2 min-h-[48px] rounded-control bg-positive text-white text-sm font-bold hover:bg-positive disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4" strokeWidth={1.75} />
                Courier bench: confirm remaining {remaining.toLocaleString()} pcs in one tap
              </button>
            )}
            {/* Amendment 6: where this product already sits, and moving boxes
                between pallets (− here, + there — nothing else). */}
            {locations && locations.length > 0 && (
              <div className="border-t border-line px-1 py-2 mb-4">
                <button
                  type="button"
                  onClick={() => setLocationsOpen((v) => !v)}
                  aria-expanded={locationsOpen}
                  className="w-full flex items-center justify-between min-h-[48px]"
                >
                  <span className="text-xs font-bold text-secondary flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-muted" strokeWidth={1.75} />
                    On pallets: {locations.map((r) => `${r.palletCode} · ${r.boxes}`).join('  ')}
                    <span className="text-muted font-semibold">
                      ({totalLocationsBoxes} boxes total)
                    </span>
                  </span>
                  <ChevronDown
                    className={`w-5 h-5 text-muted transition-transform ${
                      locationsOpen ? 'rotate-180' : ''
                    }`}
                    strokeWidth={1.75}
                  />
                </button>
                {locationsOpen && (
                  <div className="pb-2">
                    {locations.map((row) => (
                      <LocationRowView
                        key={row.palletId}
                        row={row}
                        pallets={pallets}
                        disabled={disabled || isSubmitting}
                        onTransfer={onTransfer}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="counting-stepper-column min-w-0 shrink-0 lg:border-l lg:border-line lg:px-2">
            {/* Box count — hand counting on the same screen: steppers, quick
                adds and multipliers (Amendment 3), boxes language (Amd 1).
                Phase 28 (Ledger): the Full Boxes stepper is the hero; pack
                and partial are secondary steppers beneath it. */}
            <div className="counting-steppers min-w-0 border-t border-line pt-1 lg:pt-0 lg:border-t-0 lg:space-y-1">
              <StepperInput
                hero
                label="Full Boxes Counted"
                value={cartonsInput}
                onChange={(v) => {
                  setCartonsInput(v);
                  touch();
                }}
                disabled={disabled || isPalletSealed}
              />
              <StepperInput
                label="Pcs per Box (1 box = … pcs)"
                labelShort="Pcs per Box"
                value={packSizeInput}
                onChange={(v) => {
                  setPackSizeInput(v);
                  touch();
                }}
                min={1}
                disabled={disabled || isPalletSealed}
              />
              <div className="counting-quick flex flex-wrap items-center gap-2">
                <span className="counting-quick-label hidden sm:inline text-xs font-medium text-secondary">
                  Boxes now: <span className="tabular-nums font-bold text-ink">{totalBoxesSelected}</span>
                </span>
                {[2, 5, 10].map((n) => (
                  <button
                    key={`x${n}`}
                    type="button"
                    onClick={() => applyMultiply(n)}
                    disabled={disabled || isPalletSealed}
                    className="flex-1 sm:flex-none px-2 py-1 min-h-[48px] rounded-control text-sm font-semibold bg-white text-ink border border-edge hover:bg-soft disabled:opacity-40"
                  >
                    ×{n}
                  </button>
                ))}
                {[5, 10].map((n) => (
                  <button
                    key={`+${n}`}
                    type="button"
                    onClick={() => quickAdd(n)}
                    disabled={disabled || isPalletSealed}
                    className="flex-1 sm:flex-none px-2 py-1 min-h-[48px] rounded-control text-sm font-semibold bg-white text-ink border border-edge hover:bg-soft disabled:opacity-40"
                  >
                    +{n}<span className="sr-only min-[1500px]:not-sr-only"> boxes</span>
                  </button>
                ))}
                {remaining > 0 && packSize > 0 && remaining % packSize === 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCartonsInput(
                        String(Math.max(0, remaining / packSize - scannedGoodBoxesSelected))
                      );
                      touch();
                    }}
                    disabled={disabled || isPalletSealed}
                    className="flex-1 sm:flex-none px-2 py-1 min-h-[48px] rounded-control text-sm font-semibold bg-white text-accent border border-accent hover:bg-selection disabled:opacity-40 tabular-nums"
                    title="Set the box count to exactly what remains on this product"
                  >
                    = {remaining / packSize}<span className="sr-only min-[1500px]:not-sr-only"> (all remaining)</span>
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="counting-exceptions min-w-0 flex flex-col gap-1 lg:gap-4 min-h-0 min-[720px]:max-lg:border-l min-[720px]:max-lg:border-line min-[720px]:max-lg:pl-2 lg:border-l lg:border-line lg:pl-2">
            {/* Damage & QC — Phase 33: hidden by default (rare event).
                One tap opens it; it stays open while damage exists. The
                QC / photo / notice block scrolls inside its own region
                (below) so the total and RECORD bars under it are pinned
                in flow — always visible, never overlapped. */}
            <div className="space-y-1 lg:space-y-2">
            {/* Partial Box — Phase 37c: rare event, hidden by default
                (same pattern as Damage & QC below). One tap opens the
                stepper; it stays open while a partial quantity is
                entered, and closing zeroes it. */}
            {!showPartial ? (
              <button
                type="button"
                onClick={() => setPartialOpen(true)}
                disabled={disabled || isPalletSealed}
                className="w-full min-h-[48px] flex items-center justify-between gap-2 border border-line rounded-control px-3 text-sm font-semibold text-secondary hover:bg-soft disabled:opacity-40"
              >
                <span className="flex items-center gap-2 whitespace-nowrap shrink-0">
                  <PackageOpen className="w-4 h-4 text-muted" strokeWidth={1.75} />
                  Partial Box
                </span>
                <span className="text-xs font-medium text-muted text-right leading-tight">None</span>
              </button>
            ) : (
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <StepperInput
                    label="+ Partial Box (Loose Pcs)"
                    value={partialPcsInput}
                    onChange={(v) => {
                      setPartialPcsInput(v);
                      touch();
                    }}
                    disabled={disabled || isPalletSealed}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPartialPcsInput('0');
                    setPartialOpen(false);
                    touch();
                  }}
                  disabled={disabled || isPalletSealed}
                  className="mt-6 min-h-[48px] px-3 rounded-control border border-line text-xs font-semibold text-secondary hover:bg-soft disabled:opacity-40"
                >
                  No partial
                </button>
              </div>
            )}
            {!showDamage ? (
              <button
                type="button"
                onClick={() => setDamageOpen(true)}
                className="w-full min-h-[48px] flex items-center justify-between gap-2 border border-line rounded-control px-3 text-sm font-semibold text-secondary hover:bg-soft"
              >
                <span className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0 text-muted" strokeWidth={1.75} />
                  Damage &amp; QC
                </span>
                <span className="text-xs font-medium text-muted">None</span>
              </button>
            ) : (
            <div className={`counting-qc border-t border-line pt-4 space-y-3 lg:border-t-0 lg:pt-0 ${effectiveDamaged > 0 ? 'bg-damage -mx-4 px-4 sm:-mx-6 sm:px-6 pb-4 lg:mx-0 lg:px-3 lg:rounded-control' : ''}`}>
              <span className="text-sm font-bold text-ink flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-danger" strokeWidth={1.75} />
                Damage &amp; QC
                {effectiveDamaged > 0 && (
                  <span className="text-xs font-bold text-danger">
                    +{effectiveDamaged} damaged
                  </span>
                )}
              </span>
              {effectiveDamaged === 0 && (
                <button
                  type="button"
                  onClick={() => setDamageOpen(false)}
                  className="text-xs font-bold text-muted underline underline-offset-2"
                >
                  Hide — no damage
                </button>
              )}
              <div className="counting-qc-fields grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-4">
                <StepperInput
                  label="Damaged / Defect Units"
                  value={damagedQtyInput}
                  onChange={(v) => {
                    setDamagedQtyInput(v);
                    touch();
                    const d = parseInt(v, 10) || 0;
                    if (d > 0) {
                      if (qcStatus === 'PASS') setQcStatus('DAMAGED');
                      if (qcReasonCode === 'PASS') setQcReasonCode('PHYSICAL_DAMAGE');
                    } else if (scanDamagedUnits === 0) {
                      setQcStatus('PASS');
                      setQcReasonCode('PASS');
                    }
                  }}
                  disabled={disabled || isPalletSealed}
                />
                <div>
                  <label className="block text-xs font-semibold text-secondary mb-1">
                    Defect Reason Code
                  </label>
                  <select
                    value={qcReasonCode}
                    onChange={(e) => {
                      setQcReasonCode(e.target.value);
                      touch();
                      if (e.target.value !== 'PASS' && qcStatus === 'PASS') {
                        setQcStatus('DAMAGED');
                      }
                    }}
                    disabled={disabled || isPalletSealed || effectiveDamaged === 0}
                    className="w-full px-3 py-2 min-h-[52px] text-sm font-semibold bg-white border border-edge rounded-control focus:ring-1 focus:ring-accent focus:outline-none disabled:bg-soft disabled:text-muted"
                  >
                    <option value="PASS">PASS — No Defects (Clean)</option>
                    <option value="PHYSICAL_DAMAGE">1. Physical / Crush Damage</option>
                    <option value="WATER_DAMAGE">2. Water / Moisture Damage</option>
                    <option value="MANUFACTURING_DEFECT">3. Manufacturing Defect</option>
                    <option value="WRONG_SKU">4. Wrong Product / Item Mismatch</option>
                    <option value="PACKAGING_TORN">5. Packaging Torn / Open</option>
                    <option value="QUARANTINE_HOLD">6. Quarantine / QC Hold</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-secondary mb-1">
                    QC Inspector Remarks
                  </label>
                  <input
                    type="text"
                    value={qcRemarks}
                    onChange={(e) => {
                      setQcRemarks(e.target.value);
                      touch();
                    }}
                    placeholder="e.g. 2 boxes crushed on corner"
                    disabled={disabled || isPalletSealed || effectiveDamaged === 0}
                    className="w-full px-3 py-2 min-h-[52px] text-sm bg-white border border-edge rounded-control focus:ring-1 focus:ring-accent focus:outline-none disabled:bg-soft"
                  />
                </div>
              </div>
              {scanDamagedUnits > 0 && (
                <p className="text-[11px] font-mono text-danger">
                  Plus {scanDamagedUnits} damaged units from scanned damaged boxes
                  (whole boxes, counted in the scan session above).
                </p>
              )}
              {effectiveDamaged > 0 && (
                <p className="text-[11px] font-mono text-muted">
                  A QC reason is required before damaged stock can be recorded.
                </p>
              )}
            </div>
            )}
            {/* Phase 8: damage photo evidence — shown whenever damage exists. */}
            {effectiveDamaged > 0 && (
              <div className="border border-dashed border-damage bg-damage rounded-control p-4 space-y-2">
                <span className="text-xs font-bold text-danger flex items-center gap-1.5">
                  <Camera className="w-4 h-4" strokeWidth={1.75} />
                  Damage photos (evidence)
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  disabled={disabled || isSubmitting}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) {
                      setPhotoFiles((prev) => [...prev, ...files]);
                      photosAttachedRef.current = false;
                      touch();
                    }
                    e.target.value = '';
                  }}
                  className="block w-full text-xs text-secondary file:mr-3 file:px-3 file:py-2 file:min-h-[48px] file:rounded-control file:border file:border-damage file:bg-white file:text-xs file:font-bold file:text-danger"
                />
                {photoFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {photoFiles.map((f, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold text-secondary bg-white border border-edge rounded-control px-2 py-1"
                      >
                        {f.name}
                        <button
                          type="button"
                          aria-label={`Remove photo ${f.name}`}
                          onClick={() =>
                            setPhotoFiles((prev) => prev.filter((_, j) => j !== i))
                          }
                          className="text-danger hover:text-danger"
                        >
                          <X className="w-3.5 h-3.5" strokeWidth={2} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[11px] font-mono text-muted">
                  Photos upload when the tally is recorded with a connection — an
                  offline tally saves the count first and cannot attach photos.
                </p>
              </div>
            )}
            {errorMessage && (
              <div className="flex items-center gap-2 rounded-lg border border-damage bg-damage px-3 py-2 text-sm font-semibold text-danger">
                <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                {errorMessage}
              </div>
            )}
            {debounceNotice && (
              <div className="rounded-lg border border-attention bg-attention px-3 py-2 text-xs font-semibold text-warning">
                {debounceNotice}
              </div>
            )}
            </div>
          </div>
        </div>
        {/* Keep the total and RECORD outside the scrolling controls at every width. */}
        <div className="counting-dock mt-1 shrink-0 border-t border-edge bg-white pt-1">
          <div className="flex items-stretch gap-2">
            <div
              className={`flex min-w-0 flex-1 flex-col justify-center border px-2 py-1 ${
                displayGood > remaining && remaining >= 0 && displayGood > 0
                  ? 'border-warning bg-attention'
                  : displayGood > 0 && displayGood === remaining
                    ? 'border-positive bg-received'
                    : 'border-line bg-white'
              }`}
            >
              <span className="font-mono text-[11px] text-muted">
                {totalBoxesSelected} boxes × {packSize} pcs
                {partialPcs > 0 ? ` + ${partialPcs} loose` : ''}
                {scanSelUnits.cartons > 0 ? ` · incl. ${scanSelUnits.cartons} scanned` : ''}
              </span>
              <span className="tabular-nums text-xl font-bold leading-tight text-ink">
                {displayGood.toLocaleString()} pcs
              </span>
            </div>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={disabled || isSubmitting || isPalletSealed}
              className="min-h-[56px] min-w-0 flex-[1.35] px-2 text-[13px] font-bold tabular-nums"
            >
              {isSubmitting ? (
                'Posting Tally...'
              ) : isPalletSealed ? (
                'Pallet Sealed (Cannot Post)'
              ) : (
                <>
                  <CornerDownLeft className="hidden sm:block w-4 h-4 shrink-0 mr-2" strokeWidth={1.75} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">RECORD +{displayGood.toLocaleString()} GOOD
                  {displayDamaged > 0 ? `, +${displayDamaged.toLocaleString()} DAMAGED` : ''}
                  {targetPallet ? ` → ${targetPallet.pallet_code}` : ''}</span>
                </>
              )}
            </Button>
          </div>
          {displayGood > remaining && displayGood > 0 && (
            <p className="mt-1 text-[11px] font-bold text-warning">
              {(displayGood - remaining).toLocaleString()} over expected
            </p>
          )}
          {displayGood > 0 && displayGood === remaining && (
            <p className="mt-1 text-[11px] font-bold text-positive">
              Completes this product
            </p>
          )}
        </div>
      </form>

      {/* Smart 3-Way Pack Size Override & Half-Box Warning Modal */}
      {showPackOverrideModal && pendingTallyPayload && (
        <Modal
          isOpen={showPackOverrideModal}
          onClose={() => {
            setShowPackOverrideModal(false);
            setPendingTallyPayload(null);
          }}
          title="Pack Size Variance / Partial Box Received"
          size="md"
        >
          <div className="space-y-4">
            <div className="p-3 bg-attention border border-attention rounded-lg text-xs space-y-1">
              <p className="font-bold text-warning flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-warning" strokeWidth={1.75} />
                Pack Specification Discrepancy
              </p>
              <p className="text-secondary">
                You entered pack size <strong className="font-mono">{pendingTallyPayload.pack}</strong> (Manifest standard:{' '}
                <strong className="font-mono">{selectedItem.pack_size}</strong>)
                {pendingTallyPayload.partialQty > 0
                  ? ` with ${pendingTallyPayload.partialQty} loose units in a partial box.`
                  : '.'}
              </p>
              <p className="text-secondary font-medium">
                To maintain warehouse master catalog integrity, please select the operational reason:
              </p>
            </div>

            <div className="space-y-2">
              <label
                onClick={() => setSelectedOverrideReason('PARTIAL_HALF_BOX')}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedOverrideReason === 'PARTIAL_HALF_BOX'
                    ? 'border-accent bg-selection/70 shadow-rest ring-1 ring-accent'
                    : 'border-edge hover:bg-soft'
                }`}
              >
                <input
                  type="radio"
                  name="override_reason"
                  checked={selectedOverrideReason === 'PARTIAL_HALF_BOX'}
                  onChange={() => setSelectedOverrideReason('PARTIAL_HALF_BOX')}
                  className="mt-0.5 text-accent"
                />
                <div>
                  <div className="text-xs font-bold text-ink">
                    Partial / Half-Box Received (Standard Pack Unchanged)
                  </div>
                  <p className="text-[11px] text-secondary mt-0.5">
                    Final carton has remaining loose units. Standard carton packaging remains {selectedItem.pack_size} pcs. Catalog will NOT be modified.
                  </p>
                </div>
              </label>

              <label
                onClick={() => setSelectedOverrideReason('INNER_BOX_SHORTAGE')}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedOverrideReason === 'INNER_BOX_SHORTAGE'
                    ? 'border-danger bg-damage/70 shadow-rest ring-1 ring-danger'
                    : 'border-edge hover:bg-soft'
                }`}
              >
                <input
                  type="radio"
                  name="override_reason"
                  checked={selectedOverrideReason === 'INNER_BOX_SHORTAGE'}
                  onChange={() => setSelectedOverrideReason('INNER_BOX_SHORTAGE')}
                  className="mt-0.5 text-danger"
                />
                <div>
                  <div className="text-xs font-bold text-ink">
                    Inner Carton Shortage / Supplier Factory Defect
                  </div>
                  <p className="text-[11px] text-secondary mt-0.5">
                    Factory sealed carton was missing units internally. Log vendor discrepancy without altering standard catalog pack size.
                  </p>
                </div>
              </label>

              <label
                onClick={() => setSelectedOverrideReason('PACK_SIZE_CHANGED')}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedOverrideReason === 'PACK_SIZE_CHANGED'
                    ? 'border-warning bg-attention/70 shadow-rest ring-1 ring-warning'
                    : 'border-edge hover:bg-soft'
                }`}
              >
                <input
                  type="radio"
                  name="override_reason"
                  checked={selectedOverrideReason === 'PACK_SIZE_CHANGED'}
                  onChange={() => setSelectedOverrideReason('PACK_SIZE_CHANGED')}
                  className="mt-0.5 text-warning"
                />
                <div>
                  <div className="text-xs font-bold text-ink">
                    Permanent Pack Size Change (Update Master Catalog)
                  </div>
                  <p className="text-[11px] text-secondary mt-0.5">
                    Supplier redesigned their master carton to {pendingTallyPayload.pack} pcs. Update Product Master Catalog standard for future inwards.
                  </p>
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowPackOverrideModal(false);
                  setPendingTallyPayload(null);
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  const finalPayload = {
                    ...pendingTallyPayload,
                    overrideReason: selectedOverrideReason,
                  };
                  // Phase 37b: remember this answer for the item at
                  // this pack — the same product at the same pack
                  // never asks twice in one counting session.
                  if (selectedItem) {
                    confirmedPackRef.current.set(selectedItem.sku_code, {
                      pack: finalPayload.pack,
                      reason: selectedOverrideReason,
                    });
                  }
                  setShowPackOverrideModal(false);

                  // Check overcount on this modified payload
                  const expected = selectedItem.expected_total_qty;
                  const totalAfter =
                    countedForSelectedSku + finalPayload.good + finalPayload.damaged;
                  if (expected > 0 && totalAfter > expected * 1.5) {
                    setPendingTallyPayload(finalPayload);
                    setShowOvercountModal(true);
                  } else {
                    executePostTally(finalPayload);
                  }
                }}
                disabled={isSubmitting}
                className="bg-ink hover:bg-ink font-bold"
              >
                Confirm Reason &amp; Record Tally
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* 150% Overcount Confirmation Modal */}
      {showOvercountModal && pendingTallyPayload && (
        <Modal
          isOpen={showOvercountModal}
          onClose={() => {
            setShowOvercountModal(false);
            setPendingTallyPayload(null);
          }}
          title="Overcount Threshold Warning"
          size="sm"
        >
          <div className="space-y-4">
            <div className="p-3 bg-attention border border-attention rounded-lg text-warning text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" strokeWidth={1.75} />
              <div>
                <p className="font-bold">150% Overcount Threshold Exceeded</p>
                <p className="mt-1">
                  Logging this tally will result in a total counted quantity of{' '}
                  <strong className="font-mono text-ink">
                    {(
                      countedForSelectedSku +
                      pendingTallyPayload.good +
                      pendingTallyPayload.damaged
                    ).toLocaleString()}
                  </strong>{' '}
                  units, exceeding 150% of the manifest expected (
                  <strong className="font-mono text-ink">{expected.toLocaleString()}</strong> units).
                </p>
                <p className="mt-1.5 font-medium text-secondary">
                  Please verify physical carton counts before proceeding.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowOvercountModal(false);
                  setPendingTallyPayload(null);
                }}
                disabled={isSubmitting}
              >
                Cancel Tally
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => executePostTally(pendingTallyPayload)}
                disabled={isSubmitting}
                className="bg-warning hover:bg-warning font-bold"
              >
                {isSubmitting ? 'Posting...' : 'Confirm Overcount & Post'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
