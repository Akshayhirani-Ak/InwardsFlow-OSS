'use client';

import React, { useState, useEffect } from 'react';
import {
  ArrivalType,
  ContainerSize,
  CountingMode,
  PrintedTotals,
  StagedManifestItem,
  UserProfile,
  ProductMaster,
} from '@/types/wms';
import {
  PackageCheck,
  Trash2,
  Plus,
  AlertTriangle,
  Truck,
  Layers,
  Send,
  Star,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { calculateBoxBreakdown } from '@/lib/catalog/auto-learning';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { containerNumberIssue } from '@/lib/validation/iso6346';
import { resolveContainerNumbers, thrownMessage } from '@/lib/intake/pending';
import { comparePrintedTotals, stagedTotals } from '@/lib/intake/totals';

export interface StagedContainerUnit {
  sequenceIndex: number;
  containerNumber: string;
  containerSize: ContainerSize;
  dockDoor: string;
  documentRef: string;
  countingMode: CountingMode;
  assignedOperatorUserId: string;
  /** Phase 25: totals the source documents printed, cross-checked at publish. */
  printedTotals?: PrintedTotals;
}

export interface PublishConsignmentPayload {
  consignmentRef: string;
  supplierName: string;
  arrivalType: ArrivalType;
  notes?: string;
  containers: StagedContainerUnit[];
  items: StagedManifestItem[];
}

interface StagedManifestGridProps {
  initialConsignmentRef?: string;
  initialArrivalType?: ArrivalType;
  initialContainerNumber: string;
  initialSupplierName: string;
  initialContainerSize?: ContainerSize;
  initialDocumentRef?: string;
  initialDockDoor?: string;
  initialCountingMode?: CountingMode;
  initialItems: StagedManifestItem[];
  /** Phase 13: seed several containers at once (multi-document intake). */
  initialContainers?: StagedContainerUnit[];
  /** Phase 25: printed totals for the single-unit (unmerged) case. */
  initialPrintedTotals?: PrintedTotals;
  /** Phase 13: non-fatal extraction warnings shown above the grid. */
  initialNotice?: string;
  operators: UserProfile[];
  onPublishConsignment: (payload: PublishConsignmentPayload) => Promise<void>;
  onReset: () => void;
  disabled?: boolean;
}

export const StagedManifestGrid: React.FC<StagedManifestGridProps> = ({
  initialConsignmentRef = '',
  initialArrivalType = 'CONTAINER',
  initialContainerNumber,
  initialSupplierName,
  initialContainerSize = '40HC',
  initialDocumentRef = '',
  initialDockDoor = 'DOOR-01',
  initialCountingMode = 'GUIDED',
  initialItems,
  initialContainers,
  initialPrintedTotals,
  initialNotice = '',
  operators,
  onPublishConsignment,
  onReset,
  disabled = false,
}) => {
  const supabase = createBrowserSupabaseClient();

  const [consignmentRef, setConsignmentRef] = useState(
    initialConsignmentRef || `PO-${Date.now().toString().slice(-4)}`
  );
  const [supplierName, setSupplierName] = useState(initialSupplierName);
  const [arrivalType, setArrivalType] = useState<ArrivalType>(initialArrivalType);
  const [containers, setContainers] = useState<StagedContainerUnit[]>(() =>
    initialContainers && initialContainers.length > 0
      ? initialContainers
      : [
          {
            sequenceIndex: 1,
            containerNumber: initialContainerNumber || 'CONT-01',
            containerSize: initialContainerSize,
            dockDoor: initialDockDoor,
            documentRef: initialDocumentRef,
            countingMode: initialCountingMode,
            assignedOperatorUserId: 'ALL',
            printedTotals: initialPrintedTotals,
          },
        ]
  );
  const [notice, setNotice] = useState(initialNotice);

  const [items, setItems] = useState<StagedManifestItem[]>(initialItems);
  const [catalogMap, setCatalogMap] = useState<Record<string, ProductMaster>>({});
  const [isPublishing, setIsPublishing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  // Phase 25: publishing over a printed-totals mismatch needs a typed reason.
  const [totalsOverrideReason, setTotalsOverrideReason] = useState('');

  // Pre-load catalog products for auto-learning lookup
  useEffect(() => {
    async function loadCatalog() {
      const { data } = await supabase.from('product_master').select('*');
      if (data) {
        const map: Record<string, ProductMaster> = {};
        data.forEach((p: ProductMaster) => {
          map[p.sku_code.toUpperCase()] = p;
        });
        setCatalogMap(map);
      }
    }
    loadCatalog();
  }, [supabase]);

  // When catalog is loaded or items change, auto-enrich pack sizes from catalog
  useEffect(() => {
    if (Object.keys(catalogMap).length === 0) return;

    setItems((prev) =>
      prev.map((item) => {
        const upper = item.sku_code.trim().toUpperCase();
        const master = catalogMap[upper];
        if (master) {
          // If pack_size is 1 (or unlearned) and catalog has standard_pack_size > 1
          const packSize = master.standard_pack_size > 1 ? master.standard_pack_size : item.pack_size;
          const totalQty = item.expected_total_qty || item.expected_cartons * packSize;
          const breakdown = calculateBoxBreakdown(totalQty, packSize);

          return {
            ...item,
            pack_size: packSize,
            expected_cartons: breakdown.fullBoxes,
            partial_cartons: breakdown.partialBoxes,
            expected_partial_qty: breakdown.partialPcs,
            uom: master.uom || item.uom || 'EA',
            is_priority: item.is_priority ?? master.is_default_priority,
            container_sequence: item.container_sequence || 1,
          };
        }
        return {
          ...item,
          container_sequence: item.container_sequence || 1,
        };
      })
    );
  }, [catalogMap]);

  // Add another container to consignment
  const handleAddContainer = () => {
    const nextSeq = containers.length + 1;
    setContainers((prev) => [
      ...prev,
      {
        sequenceIndex: nextSeq,
        containerNumber: `CONT-${String(nextSeq).padStart(2, '0')}`,
        containerSize: '40HC',
        dockDoor: `DOOR-0${nextSeq}`,
        documentRef: '',
        countingMode: 'GUIDED',
        assignedOperatorUserId: 'ALL',
      },
    ]);
  };

  const handleRemoveContainer = (index: number) => {
    if (containers.length <= 1) return;
    setContainers((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateContainer = (
    index: number,
    field: keyof StagedContainerUnit,
    val: any
  ) => {
    setContainers((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val };
      return copy;
    });
  };

  const handleUpdateItem = (
    index: number,
    field: keyof StagedManifestItem,
    value: any
  ) => {
    setItems((prev) => {
      const copy = [...prev];
      const item = { ...copy[index] };

      if (field === 'expected_cartons' || field === 'pack_size' || field === 'expected_partial_qty') {
        const numVal = parseInt(value.toString(), 10) || 0;
        (item as any)[field] = numVal;

        // Auto calculate total = (full cartons * pack_size) + expected_partial_qty
        const fullQty = (item.expected_cartons || 0) * (item.pack_size || 1);
        const partialQty = item.expected_partial_qty || 0;
        item.expected_total_qty = fullQty + partialQty;
        item.partial_cartons = partialQty > 0 ? 1 : 0;
        item.ai_flag = 'OK';
      } else if (field === 'expected_total_qty') {
        const numVal = parseInt(value.toString(), 10) || 0;
        item.expected_total_qty = numVal;
        const breakdown = calculateBoxBreakdown(numVal, item.pack_size || 1);
        item.expected_cartons = breakdown.fullBoxes;
        item.partial_cartons = breakdown.partialBoxes;
        item.expected_partial_qty = breakdown.partialPcs;
        item.ai_flag = 'OK';
      } else if (field === 'sku_code') {
        const code = value.toString().toUpperCase().trim();
        item.sku_code = code;
        // Check catalog match
        const master = catalogMap[code];
        if (master) {
          item.product_name = master.product_name;
          item.uom = master.uom;
          item.is_priority = master.is_default_priority;
          // Phase 7: only a VERIFIED catalog pack size may overwrite the
          // staged manifest. An AUTO_LEARNED value is an unverified guess —
          // silently adopting it (and recomputing cartons from it) is how
          // one bad receipt used to poison every future manifest.
          if (master.pack_confidence === 'VERIFIED') {
            item.pack_size = master.standard_pack_size;
            const breakdown = calculateBoxBreakdown(item.expected_total_qty, master.standard_pack_size);
            item.expected_cartons = breakdown.fullBoxes;
            item.partial_cartons = breakdown.partialBoxes;
            item.expected_partial_qty = breakdown.partialPcs;
          }
        }
      } else if (field === 'product_name') {
        item.product_name = value.toString();
      } else if (field === 'uom') {
        item.uom = value.toString().toUpperCase();
      } else if (field === 'is_priority') {
        item.is_priority = Boolean(value);
      } else if (field === 'container_sequence') {
        item.container_sequence = Number(value) || 1;
      }

      copy[index] = item;
      return copy;
    });
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddRow = () => {
    setItems((prev) => [
      ...prev,
      {
        sku_code: `SKU-${Date.now().toString().slice(-4)}`,
        barcode: '',
        supplier_code: '',
        product_name: 'Manual Consignment Item',
        expected_cartons: 10,
        pack_size: 50,
        expected_total_qty: 500,
        partial_cartons: 0,
        expected_partial_qty: 0,
        container_sequence: 1,
        uom: 'EA',
        is_priority: false,
        ai_flag: 'OK',
      },
    ]);
  };

  const totalFullCartons = items.reduce((sum, item) => sum + (item.expected_cartons || 0), 0);
  const totalPartialBoxes = items.reduce((sum, item) => sum + (item.partial_cartons || 0), 0);
  const totalUnits = items.reduce((sum, item) => sum + (item.expected_total_qty || 0), 0);

  // Phase 25: cross-check the staged lines against the totals the
  // documents themselves printed, per container unit. Recomputed on every
  // edit, so fixing a line clears its warning immediately.
  const unitMismatches = containers
    .map((c) => ({
      unit: c,
      mismatches: comparePrintedTotals(
        stagedTotals(
          containers.length === 1
            ? items
            : items.filter((it) => (it.container_sequence || 1) === c.sequenceIndex)
        ),
        c.printedTotals
      ),
    }))
    .filter((x) => x.mismatches.length > 0);
  const totalsMismatchCount = unitMismatches.reduce((a, x) => a + x.mismatches.length, 0);
  const totalsMismatchSummary = unitMismatches
    .flatMap((x) =>
      x.mismatches.map(
        (m) => `${m.field}: document prints ${m.printed}, staged ${m.staged}`
      )
    )
    .join('; ');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consignmentRef.trim()) {
      setErrorMessage('Consignment Reference / PO Number is required.');
      return;
    }

    if (containers.some((c) => !c.containerNumber.trim())) {
      setErrorMessage('Every container or delivery unit must have a container number/reference.');
      return;
    }

    // Phase 8: ISO 6346 check digit (the server enforces it too).
    const isoIssue = containers
      .map((c) => containerNumberIssue(c.containerNumber, arrivalType))
      .find((x) => x !== null);
    if (isoIssue) {
      setErrorMessage(isoIssue);
      return;
    }

    if (items.length === 0) {
      setErrorMessage('At least one line item is required.');
      return;
    }

    // Phase 25: a printed-totals mismatch means a line is probably wrong.
    // Publishing anyway is allowed, but only with the reason on record.
    if (totalsMismatchCount > 0 && !totalsOverrideReason.trim()) {
      setErrorMessage(
        'The staged lines do not match the totals printed on the supplier document. Check the flagged figures in the totals warning, or type the override reason there to publish anyway.'
      );
      return;
    }

    try {
      setIsPublishing(true);
      setErrorMessage('');

      // Phase 14: placeholder units (CONT-PENDING) get unique numbers —
      // container numbers are unique in the database, so a shared
      // placeholder would make every later no-number consignment fail.
      const effectiveContainers = resolveContainerNumbers(
        containers,
        Date.now().toString().slice(-6)
      );
      if (
        effectiveContainers.some(
          (c, i) => c.containerNumber !== containers[i].containerNumber
        )
      ) {
        setContainers(effectiveContainers);
      }

      await onPublishConsignment({
        consignmentRef: consignmentRef.trim().toUpperCase(),
        supplierName: supplierName.trim(),
        arrivalType,
        notes:
          totalsMismatchCount > 0
            ? `Totals cross-check override: ${totalsOverrideReason.trim()} — ${totalsMismatchSummary}`
            : undefined,
        containers: effectiveContainers,
        items,
      });
    } catch (err: unknown) {
      // Phase 14: Postgrest errors are plain objects — show their real
      // message ("Container X already exists — N% completed") instead of
      // the generic fallback the operator could never act on.
      setErrorMessage(thrownMessage(err, 'Failed to publish consignment manifest.'));
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Consignment Header Configuration */}
      <div className="bg-surface rounded-card shadow-rest p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <div>
            <h2 className="text-base font-bold text-ink flex items-center gap-2 uppercase tracking-wide">
              <PackageCheck className="w-5 h-5 text-accent" strokeWidth={1.75} />
              Inwards Consignment Header &amp; Arrival Type
            </h2>
            <p className="text-xs text-muted mt-0.5">
              Specify delivery mode, umbrella PO reference, and supplier credentials.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReset}
              className="text-xs"
            >
              Reset
            </Button>
          </div>
        </div>

        {notice && (
          <div className="p-3 bg-attention border border-attention text-warning rounded-lg text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
            <span className="flex-1">{notice}</span>
            <button
              type="button"
              onClick={() => setNotice('')}
              className="font-bold underline underline-offset-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="p-3 bg-damage border border-damage text-danger rounded-lg text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Consignment Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-ink mb-1">
              Consignment Ref / PO #
            </label>
            <input
              type="text"
              value={consignmentRef}
              onChange={(e) => setConsignmentRef(e.target.value.toUpperCase())}
              placeholder="e.g. PO-8821 or BL-9901"
              required
              className="w-full px-3 py-2 bg-soft border border-line rounded font-mono font-bold text-xs uppercase focus:bg-white focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-ink mb-1">
              Supplier Name
            </label>
            <input
              type="text"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="e.g. Apex Industrial Supplies"
              required
              className="w-full px-3 py-2 bg-soft border border-line rounded text-xs font-semibold focus:bg-white focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-ink mb-1">
              Arrival Mode
            </label>
            <select
              value={arrivalType}
              onChange={(e) => setArrivalType(e.target.value as ArrivalType)}
              className="w-full px-3 py-2 bg-soft border border-line rounded text-xs font-mono font-bold text-ink focus:bg-white focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="CONTAINER">CONTAINER — Sea Container FCL (20FT / 40HC)</option>
              <option value="PALLET_FREIGHT">PALLET_FREIGHT — LCL / Local Truck Delivery</option>
              <option value="COURIER_PARCEL">COURIER_PARCEL — Loose Courier Cartons</option>
            </select>
          </div>
        </div>

        {/* Multi-Container Units Staging */}
        <div className="pt-4 border-t border-line">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-secondary flex items-center gap-1.5">
              <Truck className="w-4 h-4 text-accent" strokeWidth={1.75} />
              Arrival Containers / Delivery Units ({containers.length})
            </h3>

            {arrivalType !== 'COURIER_PARCEL' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddContainer}
                className="text-xs font-bold text-accent border-accent/30 hover:bg-selection"
              >
                <Plus className="w-3.5 h-3.5 mr-1" strokeWidth={1.75} />
                Add Another Container to Consignment
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {containers.map((c, idx) => (
              <div
                key={c.sequenceIndex}
                className="bg-soft p-4 rounded-control border border-line grid grid-cols-1 sm:grid-cols-6 gap-3 items-end"
              >
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-secondary mb-1">
                    Container #{idx + 1} Number / Truck ID
                  </label>
                  <input
                    type="text"
                    value={c.containerNumber}
                    onChange={(e) => handleUpdateContainer(idx, 'containerNumber', e.target.value.toUpperCase())}
                    placeholder="e.g. MSCU-902184-7"
                    required
                    className="w-full px-3 py-1.5 bg-surface rounded-card shadow-rest rounded text-xs font-mono font-bold uppercase focus:ring-1 focus:ring-accent focus:outline-none"
                  />
                  {containerNumberIssue(c.containerNumber, arrivalType) && (
                    <p className="text-[11px] font-semibold text-danger mt-1">
                      {containerNumberIssue(c.containerNumber, arrivalType)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-secondary mb-1">
                    Size / Spec
                  </label>
                  <select
                    value={c.containerSize}
                    onChange={(e) => handleUpdateContainer(idx, 'containerSize', e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-surface rounded-card shadow-rest rounded text-xs font-mono font-semibold text-ink focus:ring-1 focus:ring-accent focus:outline-none"
                  >
                    <option value="40HC">40HC</option>
                    <option value="40FT">40FT</option>
                    <option value="20FT">20FT</option>
                    <option value="LCL">LCL</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-secondary mb-1">
                    Dock Door
                  </label>
                  <input
                    type="text"
                    value={c.dockDoor}
                    onChange={(e) => handleUpdateContainer(idx, 'dockDoor', e.target.value)}
                    placeholder="e.g. DOOR-01"
                    className="w-full px-2.5 py-1.5 bg-surface rounded-card shadow-rest rounded text-xs font-mono focus:ring-1 focus:ring-accent focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-secondary mb-1">
                    Operator Assign
                  </label>
                  <select
                    value={c.assignedOperatorUserId}
                    onChange={(e) => handleUpdateContainer(idx, 'assignedOperatorUserId', e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-surface rounded-card shadow-rest rounded text-xs font-mono focus:ring-1 focus:ring-accent focus:outline-none"
                  >
                    <option value="ALL">ALL (Any Shift)</option>
                    {operators.map((op) => (
                      <option key={op.id} value={op.user_id}>
                        {op.user_id} ({op.full_name})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-end">
                  {containers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveContainer(idx)}
                      className="p-1.5 rounded text-danger hover:bg-damage"
                      title="Remove Container"
                    >
                      <Trash2 className="w-4 h-4" strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Manifest Items Grid with Half-Box Intelligence */}
      <div className="bg-surface rounded-card shadow-rest overflow-hidden">
        <div className="px-6 py-4 bg-soft border-b border-line flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-ink uppercase tracking-wide flex items-center gap-2">
              <Layers className="w-4 h-4 text-accent" strokeWidth={1.75} />
              Manifest Products &amp; Half-Box Breakdown ({items.length})
            </h3>
            <p className="text-[11px] text-muted mt-0.5 font-medium">
              Pack sizes are automatically looked up from the Master Catalog. Partial/half boxes are broken down cleanly.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddRow}
            className="text-xs border-line"
          >
            <Plus className="w-3.5 h-3.5 mr-1" strokeWidth={1.75} />
            Add SKU Row
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-line bg-soft text-[11px] font-bold text-secondary uppercase tracking-wider">
                {containers.length > 1 && <th className="py-2.5 px-3">Container</th>}
                <th className="py-2.5 px-4 font-mono">SKU Code</th>
                <th className="py-2.5 px-4">Product Name &amp; Description</th>
                <th className="py-2.5 px-3 text-center">UOM</th>
                <th className="py-2.5 px-3 text-right font-mono">Full Boxes</th>
                <th className="py-2.5 px-3 text-right font-mono">Pack Size</th>
                <th className="py-2.5 px-3 text-right font-mono">Partial Pcs</th>
                <th className="py-2.5 px-3 text-right font-mono">Total Pieces</th>
                <th className="py-2.5 px-3 text-center">Priority</th>
                <th className="py-2.5 px-3 text-right">Remove</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-soft text-xs">
              {items.map((item, idx) => {
                const breakdown = calculateBoxBreakdown(item.expected_total_qty, item.pack_size);
                const hasPartial = item.expected_partial_qty ? item.expected_partial_qty > 0 : false;
                const isCatalogKnown = Boolean(catalogMap[item.sku_code.toUpperCase()]);

                return (
                  <tr key={idx} className="hover:bg-soft transition-colors">
                    {/* Container sequence allocation */}
                    {containers.length > 1 && (
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <select
                          value={item.container_sequence || 1}
                          onChange={(e) => handleUpdateItem(idx, 'container_sequence', Number(e.target.value))}
                          className="px-2 py-1 bg-surface rounded-card shadow-rest rounded text-xs font-mono font-bold text-ink"
                        >
                          {containers.map((c) => (
                            <option key={c.sequenceIndex} value={c.sequenceIndex}>
                              Cont #{c.sequenceIndex} ({c.containerNumber})
                            </option>
                          ))}
                        </select>
                      </td>
                    )}

                    {/* SKU Code */}
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={item.sku_code}
                          onChange={(e) => handleUpdateItem(idx, 'sku_code', e.target.value)}
                          className="px-2 py-1 bg-surface rounded-card shadow-rest rounded font-mono font-bold text-ink text-xs w-28 uppercase focus:ring-1 focus:ring-accent focus:outline-none"
                        />
                        {isCatalogKnown && (
                          <span
                            title="Recognized in Master Catalog"
                            className="p-0.5 rounded bg-received text-positive border border-received"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                      {item.supplier_code ? (
                        <div
                          className="mt-1 font-mono text-[10px] text-muted"
                          title="Supplier's own code for this line — kept as an alias; either code matches this product"
                        >
                          Supplier: {item.supplier_code}
                        </div>
                      ) : null}
                    </td>

                    {/* Product Name */}
                    <td className="py-2.5 px-4">
                      <input
                        type="text"
                        value={item.product_name}
                        onChange={(e) => handleUpdateItem(idx, 'product_name', e.target.value)}
                        className="w-full px-2 py-1 bg-surface rounded-card shadow-rest rounded text-xs text-ink focus:ring-1 focus:ring-accent focus:outline-none"
                      />
                      {hasPartial && (
                        <div className="text-[10px] text-warning font-mono font-bold mt-0.5">
                          Half-box breakdown: {breakdown.formattedSummary}
                        </div>
                      )}
                    </td>

                    {/* UOM */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <input
                        type="text"
                        value={item.uom || 'EA'}
                        onChange={(e) => handleUpdateItem(idx, 'uom', e.target.value)}
                        className="w-12 text-center px-1 py-1 bg-surface rounded-card shadow-rest rounded text-xs font-mono font-bold uppercase focus:ring-1 focus:ring-accent focus:outline-none"
                      />
                    </td>

                    {/* Full Boxes */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono">
                      <input
                        type="number"
                        min={0}
                        value={item.expected_cartons}
                        onChange={(e) => handleUpdateItem(idx, 'expected_cartons', e.target.value)}
                        onWheel={(e) => e.currentTarget.blur()}
                        className="w-16 text-right px-2 py-1 bg-surface rounded-card shadow-rest rounded text-xs font-mono font-bold text-ink focus:ring-1 focus:ring-accent focus:outline-none"
                      />
                    </td>

                    {/* Pack Size */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono">
                      <input
                        type="number"
                        min={1}
                        value={item.pack_size}
                        onChange={(e) => handleUpdateItem(idx, 'pack_size', e.target.value)}
                        onWheel={(e) => e.currentTarget.blur()}
                        className="w-16 text-right px-2 py-1 bg-surface rounded-card shadow-rest rounded text-xs font-mono text-secondary focus:ring-1 focus:ring-accent focus:outline-none"
                      />
                    </td>

                    {/* Partial Box Pcs (Half-box remainder) */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono">
                      <input
                        type="number"
                        min={0}
                        value={item.expected_partial_qty || 0}
                        onChange={(e) => handleUpdateItem(idx, 'expected_partial_qty', e.target.value)}
                        onWheel={(e) => e.currentTarget.blur()}
                        placeholder="0"
                        title="Pieces in partial / half box"
                        className={`w-16 text-right px-2 py-1 border rounded text-xs font-mono font-bold ${
                          item.expected_partial_qty && item.expected_partial_qty > 0
                            ? 'bg-attention border-attention text-warning'
                            : 'bg-white border-line text-secondary'
                        }`}
                      />
                    </td>

                    {/* Total Pieces */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono">
                      <input
                        type="number"
                        min={0}
                        value={item.expected_total_qty}
                        onChange={(e) => handleUpdateItem(idx, 'expected_total_qty', e.target.value)}
                        onWheel={(e) => e.currentTarget.blur()}
                        className="w-20 text-right px-2 py-1 bg-surface rounded-card shadow-rest rounded text-xs font-mono font-black text-accent focus:ring-1 focus:ring-accent focus:outline-none"
                      />
                    </td>

                    {/* Priority Stock Segregation Flag */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleUpdateItem(idx, 'is_priority', !item.is_priority)}
                        className={`p-1.5 rounded transition-colors ${
                          item.is_priority
                            ? 'bg-attention text-warning border border-attention'
                            : 'text-line hover:text-warning'
                        }`}
                        title={item.is_priority ? 'Priority Stock Enabled' : 'Mark as Priority Stock'}
                      >
                        <Star
                          className={`w-4 h-4 ${item.is_priority ? 'fill-amber-500 text-warning' : ''}`}
                          strokeWidth={1.75}
                        />
                      </button>
                    </td>

                    {/* Remove */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(idx)}
                        className="p-1 rounded text-muted hover:text-danger hover:bg-damage"
                        title="Delete line item"
                      >
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Phase 25: printed-totals cross-check warning */}
        {unitMismatches.length > 0 && (
          <div className="px-6 py-3 bg-attention border-t border-attention text-xs text-warning space-y-2">
            <p className="font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-warning" strokeWidth={1.75} />
              Staged lines don&apos;t match the totals printed on the document
            </p>
            <ul className="list-disc pl-5 space-y-0.5">
              {unitMismatches.map((x) => (
                <li key={x.unit.sequenceIndex}>
                  {containers.length > 1 && (
                    <span className="font-semibold">
                      {x.unit.containerNumber || `Unit ${x.unit.sequenceIndex}`}:{' '}
                    </span>
                  )}
                  {x.mismatches.map((m) => (
                    <span key={m.field} className="mr-3">
                      {m.field}: document prints <strong>{m.printed.toLocaleString()}</strong>,
                      staged <strong>{m.staged.toLocaleString()}</strong>
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            <p>
              A line was most likely misread. Fix the lines above, or publish anyway with the
              reason recorded:
            </p>
            <input
              type="text"
              value={totalsOverrideReason}
              onChange={(e) => setTotalsOverrideReason(e.target.value)}
              placeholder="Override reason — e.g. document footer counts the outer pallet as a carton, verified with supplier list"
              className="w-full px-3 py-2 text-xs bg-white border border-warning rounded focus:ring-1 focus:ring-warning focus:outline-none"
            />
          </div>
        )}

        {/* Tally Summary Bar */}
        <div className="px-6 py-3 bg-soft border-t border-line flex flex-wrap items-center justify-between text-xs text-secondary font-mono">
          <div className="flex items-center gap-4">
            <span>
              SKUs: <strong className="text-ink font-bold">{items.length}</strong>
            </span>
            <span>
              Full Cartons: <strong className="text-ink font-bold">{totalFullCartons.toLocaleString()}</strong>
            </span>
            {totalPartialBoxes > 0 && (
              <span className="text-warning font-bold">
                Partial/Half Boxes: {totalPartialBoxes}
              </span>
            )}
            <span>
              Total Units:{' '}
              <strong className="text-accent font-black text-sm">
                {totalUnits.toLocaleString()} pcs
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={isPublishing || disabled || (totalsMismatchCount > 0 && !totalsOverrideReason.trim())}
              className="font-bold"
            >
              <Send className="w-4 h-4 mr-2" strokeWidth={1.75} />
              {isPublishing ? 'Publishing Consignment...' : 'Publish Consignment to Receiving Dock'}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
};
