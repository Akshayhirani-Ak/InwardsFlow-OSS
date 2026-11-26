'use client';

import React, { useState } from 'react';
import { Container, ExpectedItem, Pallet, PalletEntry } from '@/types/wms';
import {
  Printer,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Barcode,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { exportGrnToExcel } from '@/lib/utils/excel-export';
import { cleanDisplay } from '@/lib/utils/auth-mapper';

interface GrnReconciliationModalProps {
  isOpen: boolean;
  onClose: () => void;
  container: Container | null;
  items: ExpectedItem[];
  pallets: Pallet[];
  entries: PalletEntry[];
}

export const GrnReconciliationModal: React.FC<GrnReconciliationModalProps> = ({
  isOpen,
  onClose,
  container,
  items,
  pallets,
  entries,
}) => {
  const [activeTab, setActiveTab] = useState<'reconciliation' | 'placards' | 'qc'>('reconciliation');

  if (!container) return null;

  // Active (non-voided) entries
  const activeEntries = entries.filter((e) => !e.is_voided);

  // Group tallies by SKU
  const skuTallies: Record<
    string,
    { good: number; damaged: number; total: number; remarks: string[] }
  > = {};

  activeEntries.forEach((e) => {
    if (!skuTallies[e.item_id]) {
      skuTallies[e.item_id] = { good: 0, damaged: 0, total: 0, remarks: [] };
    }
    skuTallies[e.item_id].good += e.good_qty;
    skuTallies[e.item_id].damaged += e.damaged_qty;
    skuTallies[e.item_id].total += e.good_qty + e.damaged_qty;
    if (e.qc_remarks) {
      skuTallies[e.item_id].remarks.push(`${e.qc_reason_code}: ${e.qc_remarks}`);
    }
  });

  const totalExpected = items.reduce((a, b) => a + b.expected_total_qty, 0);
  const totalGood = Object.values(skuTallies).reduce((a, b) => a + b.good, 0);
  const totalDamaged = Object.values(skuTallies).reduce((a, b) => a + b.damaged, 0);
  // Phase 5: received means GOOD units. Damaged stock is physically present
  // but it is not received inventory — counting it as received made a
  // fully-damaged SKU reconcile as MATCHED with zero variance.
  const totalReceived = totalGood;
  const netVariance = totalReceived - totalExpected;

  // Defect entries for QC Discrepancy Tab
  const defectEntries = activeEntries.filter(
    (e) => e.damaged_qty > 0 || e.qc_reason_code !== 'PASS'
  );

  const handlePrint = () => {
    // The printed Goods Received sheet is the designed document (Phase 23),
    // not this on-screen reconciliation view. Pallet placards still print
    // from the modal itself — they are laid out for it.
    if (activeTab === 'placards') {
      window.print();
      return;
    }
    window.open(
      `/print/goods-received/${container.consignment_id || container.id}`,
      '_blank'
    );
  };

  const handleExportExcel = () => {
    exportGrnToExcel(container, items, pallets, entries);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Goods Received Note (GRN) &amp; Floor Reconciliation"
      size="xl"
    >
      <div className="space-y-4">
        {/* Modal Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-300">
          {/* Tab Navigation */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-300 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('reconciliation')}
              className={`px-3 py-1.5 rounded transition-colors ${
                activeTab === 'reconciliation'
                  ? 'bg-white text-slate-900 shadow-sm font-bold border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              GRN Reconciliation
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('placards')}
              className={`px-3 py-1.5 rounded transition-colors ${
                activeTab === 'placards'
                  ? 'bg-white text-slate-900 shadow-sm font-bold border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Pallet Placards ({pallets.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('qc')}
              className={`px-3 py-1.5 rounded transition-colors ${
                activeTab === 'qc'
                  ? 'bg-white text-slate-900 shadow-sm font-bold border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              QC Discrepancies ({defectEntries.length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportExcel}
              className="font-mono text-xs"
            >
              <FileSpreadsheet className="w-4 h-4 mr-1.5 text-emerald-700" strokeWidth={1.75} />
              Download .XLSX
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={handlePrint}
              className="font-mono text-xs"
            >
              <Printer className="w-4 h-4 mr-1.5" strokeWidth={1.75} />
              Print
            </Button>
          </div>
        </div>

        {/* ------------------------------------------------------------------- */}
        {/* TAB 1: GRN RECONCILIATION */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === 'reconciliation' && (
          <div id="printable-grn-document" className="bg-white p-6 border border-slate-300 rounded-xl space-y-6 print:border-none print:p-0">
            {/* Header & Meta */}
            <div className="flex justify-between items-start border-b-2 border-slate-900 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight uppercase">
                    Goods Received Note (GRN)
                  </h2>
                  <Badge variant="blue" size="sm" className="font-mono">
                    Tier-1 Commercial
                  </Badge>
                </div>
                <p className="text-xs text-slate-600 mt-1 font-mono">
                  Document Ref: GRN-{container.container_number.replace(/[^A-Z0-9]/gi, '')}-{new Date().toISOString().slice(0, 10)}
                </p>
              </div>

              <div className="text-right font-mono text-xs text-slate-600">
                <div>Date: <strong>{new Date().toLocaleDateString()}</strong></div>
                <div>Time: <strong>{new Date().toLocaleTimeString()}</strong></div>
                <div>Status: <strong className="uppercase text-slate-900">{container.status}</strong></div>
              </div>
            </div>

            {/* Container Information Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono">
              <div>
                <span className="text-slate-500 block text-[10px] font-semibold">Container Number</span>
                <span className="font-bold text-slate-900 text-sm">{container.container_number}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] font-semibold">Container Size</span>
                <span className="font-bold text-slate-900">{container.container_size || '40HC'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] font-semibold">Dock Door</span>
                <span className="font-bold text-slate-900">{container.dock_door || 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] font-semibold">Counting Protocol</span>
                <span className="font-bold text-slate-900">{container.counting_mode || 'GUIDED'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] font-semibold">Supplier / Shipper</span>
                <span className="font-bold text-slate-900">{container.supplier_name || 'Standard Inbound'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] font-semibold">Document Reference</span>
                <span className="font-bold text-slate-900">{container.document_ref || 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] font-semibold">Assigned Operator</span>
                <span className="font-bold text-slate-900">{cleanDisplay(container.assigned_operator_user_id)}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] font-semibold">Pallets Generated</span>
                <span className="font-bold text-slate-900 tabular-nums">{pallets.length} Units</span>
              </div>
            </div>

            {/* Summary Statistics Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-slate-50 border border-slate-300 rounded-lg">
                <span className="text-[10px] font-mono text-slate-500 uppercase font-semibold">Expected Units</span>
                <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                  {totalExpected.toLocaleString()}
                </div>
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg">
                <span className="text-[10px] font-mono text-emerald-700 uppercase font-semibold">Good Units Received</span>
                <div className="text-xl font-bold font-mono tabular-nums text-[#16A34A] mt-0.5">
                  {totalGood.toLocaleString()}
                </div>
              </div>

              <div className="p-3 bg-red-50 border border-red-300 rounded-lg">
                <span className="text-[10px] font-mono text-red-700 uppercase font-semibold">QC Defect Units</span>
                <div className="text-xl font-bold font-mono tabular-nums text-[#DC2626] mt-0.5">
                  {totalDamaged.toLocaleString()}
                </div>
              </div>

              <div
                className={`p-3 rounded-lg border ${
                  netVariance === 0
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : netVariance > 0
                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                    : 'bg-red-50 border-red-300 text-red-900'
                }`}
              >
                <span className="text-[10px] font-mono uppercase font-semibold">Net Physical Variance</span>
                <div className="text-xl font-bold font-mono tabular-nums mt-0.5">
                  {netVariance === 0 ? 'MATCHED (0)' : netVariance > 0 ? `+${netVariance.toLocaleString()}` : netVariance.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Reconciliation Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b-2 border-slate-300 bg-slate-100 text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                    <th className="py-2.5 px-3 font-mono">Product Code</th>
                    <th className="py-2.5 px-3">Description</th>
                    <th className="py-2.5 px-2 font-mono">UOM</th>
                    <th className="py-2.5 px-2 font-mono text-right">Pack Size</th>
                    <th className="py-2.5 px-3 font-mono text-left">Box Breakdown</th>
                    <th className="py-2.5 px-3 font-mono text-right">Expected</th>
                    <th className="py-2.5 px-3 font-mono text-right">Good</th>
                    <th className="py-2.5 px-3 font-mono text-right">Damaged</th>
                    <th className="py-2.5 px-3 font-mono text-right">Total Counted</th>
                    <th className="py-2.5 px-3 font-mono text-right">Variance</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {items.map((sku) => {
                    const tally = skuTallies[sku.id] || { good: 0, damaged: 0, total: 0, remarks: [] };
                    // Phase 5: variance + MATCHED are judged on GOOD units,
                    // and a line with damage is never a clean MATCHED.
                    const diff = tally.good - sku.expected_total_qty;
                    const isMatched = diff === 0 && tally.good > 0 && tally.damaged === 0;
                    const isOver = diff > 0;
                    const isUnder = diff < 0;

                    return (
                      <tr key={sku.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>{sku.sku_code}</span>
                            {sku.is_priority && (
                              <span className="text-[9px] font-mono font-bold text-amber-800 bg-amber-100 border border-amber-300 px-1 rounded">
                                PRIORITY
                              </span>
                            )}
                            {sku.is_unlisted_addition && (
                              <span className="text-[9px] text-amber-700 bg-amber-50 px-1 rounded border border-amber-200">
                                Unlisted
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700">{sku.product_name}</td>
                        <td className="py-2.5 px-2 font-mono text-slate-600">{sku.uom || 'EA'}</td>
                        <td className="py-2.5 px-2 font-mono tabular-nums text-right text-slate-600">
                          {sku.pack_size}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700">
                          <span>{sku.expected_cartons} Full</span>
                          {Boolean(sku.partial_cartons && sku.partial_cartons > 0) && (
                            <span className="text-indigo-700 font-semibold ml-1">
                              + 1p ({sku.expected_partial_qty} pcs)
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-right font-semibold text-slate-800">
                          {sku.expected_total_qty.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-right text-[#16A34A] font-semibold">
                          {tally.good.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-right text-[#DC2626] font-semibold">
                          {tally.damaged > 0 ? tally.damaged.toLocaleString() : '-'}
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-right font-bold text-slate-900">
                          {tally.total.toLocaleString()}
                        </td>
                        <td
                          className={`py-2.5 px-3 font-mono tabular-nums text-right font-bold ${
                            isMatched
                              ? 'text-[#16A34A]'
                              : isOver
                              ? 'text-[#D97706]'
                              : 'text-[#DC2626]'
                          }`}
                        >
                          {diff === 0 ? '0' : diff > 0 ? `+${diff.toLocaleString()}` : diff.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {isMatched ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#16A34A] bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-[#16A34A]" strokeWidth={1.75} /> MATCHED
                            </span>
                          ) : isOver ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#D97706] bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                              <AlertTriangle className="w-3 h-3 text-[#D97706]" strokeWidth={1.75} /> OVERCOUNT
                            </span>
                          ) : diff === 0 && tally.damaged > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#D97706] bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                              <AlertTriangle className="w-3 h-3 text-[#D97706]" strokeWidth={1.75} /> RECEIVED + DAMAGE
                            </span>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#DC2626] bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
                                <AlertTriangle className="w-3 h-3 text-[#DC2626]" strokeWidth={1.75} /> SHORTAGE
                              </span>
                              {sku.shortage_disposition && (
                                <span className="text-[9px] font-mono text-amber-800 bg-amber-50 px-1 py-0.2 rounded border border-amber-200">
                                  {sku.shortage_disposition}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Official Signoff Box */}
            <div className="grid grid-cols-2 gap-8 pt-6 border-t border-slate-300 font-mono text-xs">
              <div className="space-y-4">
                <p className="text-slate-500 uppercase text-[10px] font-bold">Warehouse Receiving Signoff</p>
                <div className="border-b border-slate-400 pt-8" />
                <div className="flex justify-between text-slate-600">
                  <span>Receiver: {cleanDisplay(container.assigned_operator_user_id)}</span>
                  <span>Date: ____________________</span>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-slate-500 uppercase text-[10px] font-bold">Inventory Control Approval</p>
                <div className="border-b border-slate-400 pt-8" />
                <div className="flex justify-between text-slate-600">
                  <span>Inventory Controller</span>
                  <span>Date: ____________________</span>
                </div>
              </div>
            </div>

            {/* System Attribution */}
            <div className="text-center pt-2 text-[10px] font-mono text-slate-400">
              InwardsFlow WMS • Enterprise Physical Inventory Engine
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------- */}
        {/* TAB 2: PALLET PLACARDS / LICENSE PLATES */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === 'placards' && (
          <div className="space-y-6">
            <p className="text-xs text-slate-600">
              Printable warehouse pallet placards / license plate tags. Affix to each pallet before racking or putaway.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {pallets.map((plt) => {
                const pltEntries = activeEntries.filter((e) => e.pallet_id === plt.id);
                const goodSum = pltEntries.reduce((s, e) => s + e.good_qty, 0);
                const damagedSum = pltEntries.reduce((s, e) => s + e.damaged_qty, 0);
                const totalPltUnits = goodSum + damagedSum;

                return (
                  <div
                    key={plt.id}
                    className="bg-white border-2 border-slate-900 rounded-xl p-5 shadow-sm space-y-4 print:break-inside-avoid"
                  >
                    {/* Top Placard Header */}
                    <div className="flex items-center justify-between border-b-2 border-slate-900 pb-3">
                      <div>
                        <span className="text-[10px] font-mono uppercase font-bold text-slate-500 block">
                          Warehouse Pallet Tag
                        </span>
                        <span className="font-mono text-2xl font-black text-slate-900 tracking-tight">
                          {plt.pallet_code}
                        </span>
                      </div>
                      <Badge
                        variant={plt.status === 'sealed' ? 'neutral' : 'green'}
                        size="md"
                        className="font-mono text-xs font-bold"
                      >
                        {plt.status.toUpperCase()}
                      </Badge>
                    </div>

                    {/* Metadata Strip */}
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-slate-50 p-2.5 rounded border border-slate-300">
                      <div>
                        <span className="text-slate-500 text-[10px] block font-semibold">Container</span>
                        <strong className="text-slate-900">{container.container_number}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 text-[10px] block font-semibold">Dock Door</span>
                        <strong className="text-slate-900">{container.dock_door || 'N/A'}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 text-[10px] block font-semibold">Created Timestamp</span>
                        <span>{new Date(plt.created_at).toLocaleDateString()}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 text-[10px] block font-semibold">Total Stock Placed</span>
                        <strong className="text-slate-900 text-sm tabular-nums">{totalPltUnits.toLocaleString()} units</strong>
                      </div>
                    </div>

                    {/* Pallet Contents Table */}
                    <div className="border border-slate-300 rounded overflow-hidden">
                      <table className="w-full text-left text-xs font-mono">
                        <thead>
                          <tr className="bg-slate-100 border-b border-slate-300 text-[10px] font-bold text-slate-700 uppercase">
                            <th className="py-1.5 px-3">Product Code</th>
                            <th className="py-1.5 px-2 text-right">Boxes</th>
                            <th className="py-1.5 px-3 text-right">Good</th>
                            <th className="py-1.5 px-3 text-right">Damaged</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {pltEntries.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="py-4 text-center text-slate-400 text-xs">
                                No stock items tallied on this pallet yet.
                              </td>
                            </tr>
                          ) : (
                            pltEntries.map((e) => {
                              const item = items.find((i) => i.id === e.item_id);
                              return (
                                <tr key={e.id}>
                                  <td className="py-1.5 px-3 font-bold text-slate-900">{item?.sku_code}</td>
                                  <td className="py-1.5 px-2 text-right tabular-nums">{e.cartons_counted}</td>
                                  <td className="py-1.5 px-3 text-right font-bold text-[#16A34A] tabular-nums">+{e.good_qty}</td>
                                  <td className="py-1.5 px-3 text-right font-bold text-[#DC2626] tabular-nums">{e.damaged_qty > 0 ? `+${e.damaged_qty}` : '0'}</td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Barcode Mock */}
                    <div className="pt-2 text-center border-t border-slate-200">
                      <div className="h-10 bg-slate-100 border border-dashed border-slate-300 rounded flex items-center justify-center gap-1 font-mono text-[10px] text-slate-500">
                        <Barcode className="w-6 h-6 text-slate-700" strokeWidth={1.5} />
                        *{container.container_number}-{plt.pallet_code}*
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------- */}
        {/* TAB 3: QC DISCREPANCY & DEFECT LOG */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === 'qc' && (
          <div className="space-y-4">
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-600 flex-shrink-0" strokeWidth={1.75} />
                <span>
                  <strong>Quality Control Quarantine &amp; Damage Log:</strong> Showing all units segregated from prime inventory.
                </span>
              </div>
              <span className="font-mono font-bold text-sm tabular-nums">
                {totalDamaged.toLocaleString()} Total Damaged Units
              </span>
            </div>

            <div className="border border-slate-300 rounded-lg overflow-hidden bg-white">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                    <th className="py-2.5 px-4 font-mono">Timestamp</th>
                    <th className="py-2.5 px-3 font-mono">Pallet</th>
                    <th className="py-2.5 px-4 font-mono">Product Code</th>
                    <th className="py-2.5 px-4">Product Name</th>
                    <th className="py-2.5 px-3 text-right font-mono">Defect Units</th>
                    <th className="py-2.5 px-4">QC Reason Code</th>
                    <th className="py-2.5 px-4">Inspector Remarks</th>
                    <th className="py-2.5 px-4">Inspector</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {defectEntries.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500" strokeWidth={1.75} />
                        <p className="font-semibold text-xs text-slate-700">Zero QC Defects Recorded</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          100% of received stock has passed initial physical inspection without damage.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    defectEntries.map((e) => {
                      const item = items.find((i) => i.id === e.item_id);
                      const plt = pallets.find((p) => p.id === e.pallet_id);

                      return (
                        <tr key={e.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-4 font-mono text-slate-500 text-[11px] whitespace-nowrap">
                            {new Date(e.created_at).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                            {plt?.pallet_code || 'PLT'}
                          </td>
                          <td className="py-2.5 px-4 font-mono font-bold text-slate-900">
                            {item?.sku_code || '---'}
                          </td>
                          <td className="py-2.5 px-4 text-slate-700">{item?.product_name}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-[#DC2626] tabular-nums">
                            +{e.damaged_qty.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-4">
                            <span className="font-mono text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
                              {e.qc_reason_code}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 text-[11px]">
                            {e.qc_remarks || 'None specified'}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-slate-700 text-[11px]">
                            {cleanDisplay(e.operator_user_id || e.operator_name)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
