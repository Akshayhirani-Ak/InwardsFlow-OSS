// InwardsFlow Enterprise WMS â€” Multi-Sheet Excel (.xlsx) Report Generator
// InwardsFlow Receiving & Inventory Engine
import * as XLSX from 'xlsx';
import type { Consignment, Container, ExpectedItem, Pallet, PalletEntry } from '@/types/wms';
import { toCleanUserId } from './auth-mapper';

export interface GenerateGrnWorkbookParams {
  container: Container;
  items: ExpectedItem[];
  pallets: Pallet[];
  entries: PalletEntry[];
  consignment?: Consignment | null;
}

export function exportGrnToExcel(
  paramsOrContainer: GenerateGrnWorkbookParams | Container,
  itemsArg?: ExpectedItem[],
  palletsArg?: Pallet[],
  entriesArg?: PalletEntry[],
  consignmentArg?: Consignment | null
): void {
  let container: Container;
  let items: ExpectedItem[];
  let pallets: Pallet[];
  let entries: PalletEntry[];
  let consignment: Consignment | null = null;

  if (itemsArg && palletsArg && entriesArg) {
    container = paramsOrContainer as Container;
    items = itemsArg;
    pallets = palletsArg;
    entries = entriesArg;
    consignment = consignmentArg || null;
  } else {
    const p = paramsOrContainer as GenerateGrnWorkbookParams;
    container = p.container;
    items = p.items;
    pallets = p.pallets;
    entries = p.entries;
    consignment = p.consignment || null;
  }

  const wb = XLSX.utils.book_new();

  // 1. SHEET 1: Container Overview & Metadata
  const validEntries = entries.filter((e) => !e.is_voided);
  const totalExpected = items.reduce((s, i) => s + (Number(i.expected_total_qty) || 0), 0);
  const totalGood = validEntries.reduce((s, e) => s + (Number(e.good_qty) || 0), 0);
  const totalDamaged = validEntries.reduce((s, e) => s + (Number(e.damaged_qty) || 0), 0);
  const totalCounted = totalGood + totalDamaged;

  const summaryData = [
    ['INWARDSFLOW ENTERPRISE WMS â€” OFFICIAL GOODS RECEIVED NOTE (GRN)'],
    ['OFFICIAL PHYSICAL RECEIVING & RECONCILIATION AUDIT RECORD'],
    [],
    ['METADATA FIELD', 'VALUE'],
    ['Consignment Reference', consignment?.consignment_ref || container.document_ref || 'N/A'],
    ['Arrival Mode / Type', container.arrival_type || 'CONTAINER'],
    ['Container / Vehicle Number', container.container_number],
    ['Container Sequence', container.sequence_index ? `Unit ${container.sequence_index}` : 'Single Unit'],
    ['Container Size', container.container_size || '40HC'],
    ['Document Reference (B/L #)', container.document_ref || 'N/A'],
    ['Receiving Dock Door', container.dock_door || 'N/A'],
    ['Received by', container.received_by_name || 'Not recorded'],
    ['Checked by', container.checked_by_name || 'Not recorded'],
    ['Supplier / Shipper', container.supplier_name || 'General Inbound'],
    ['Container Status', container.status.toUpperCase()],
    ['Shortage Disposition', container.shortage_disposition || 'NONE / CLEAN'],
    ['Reconciliation Progress', `${container.completion_percentage}%`],
    ['Assigned Operator ID', toCleanUserId(container.assigned_operator_user_id || 'ALL')],
    ['Total Products in Manifest', items.length],
    ['Total Pallets Staged', pallets.length],
    ['Total Expected Units', totalExpected],
    ['Total Good Units Received', totalGood],
    ['Total QC Defect Units', totalDamaged],
    ['Net Physical Variance', totalCounted - totalExpected],
    ['Report Generated Timestamp', new Date().toISOString()],
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Container Summary');

  // 2. SHEET 2: SKU Reconciliation Manifest (With Half-Box Breakdown)
  const skuRows = items.map((sku) => {
    const skuEntries = validEntries.filter((e) => e.item_id === sku.id);
    const good = skuEntries.reduce((s, e) => s + (Number(e.good_qty) || 0), 0);
    const dmg = skuEntries.reduce((s, e) => s + (Number(e.damaged_qty) || 0), 0);
    const exp = Number(sku.expected_total_qty) || 0;
    const variance = good - exp; // Phase 5: variance is good-vs-expected; damaged is reported, never received

    const palletBreakdown = skuEntries
      .map((e) => {
        const plt = pallets.find((p) => p.id === e.pallet_id);
        return `${plt ? plt.pallet_code : 'PLT'}: ${e.good_qty}`;
      })
      .join(' + ');

    const qcNotes = Array.from(
      new Set(
        skuEntries
          .map((e) => (e.qc_reason_code !== 'PASS' ? `${e.qc_reason_code}: ${e.qc_remarks || ''}` : null))
          .filter(Boolean)
      )
    ).join('; ');

    return {
      'Product Code': sku.sku_code,
      'Product Description': sku.product_name,
      'Priority Stock': sku.is_priority ? 'YES (PRIORITY)' : 'NO',
      'UOM': sku.uom || 'EA',
      'Expected Full Boxes': sku.expected_cartons,
      'Expected Partial Boxes': sku.partial_cartons || 0,
      'Expected Partial Loose Pcs': sku.expected_partial_qty || 0,
      'Units Per Full Box': sku.pack_size,
      'Expected Total Qty': exp,
      'Good Units Received': good,
      'QC Damaged Units': dmg,
      'Total Handled (Good + Damaged)': good + dmg,
      'Net Variance': variance === 0 ? 'MATCHED (0)' : variance > 0 ? `+${variance}` : String(variance),
      'Shortage Disposition': sku.shortage_disposition || (variance < 0 ? 'PENDING' : 'N/A'),
      'Pallet Distribution': palletBreakdown || 'None',
      'QC Inspection Status': qcNotes || 'PASS',
    };
  });
  const skuWs = XLSX.utils.json_to_sheet(skuRows);
  XLSX.utils.book_append_sheet(wb, skuWs, 'GRN Reconciliation');

  // 3. SHEET 3: Complete Pallet Ledger Rows
  const ledgerRows = validEntries.map((e) => {
    const plt = pallets.find((p) => p.id === e.pallet_id);
    const sku = items.find((i) => i.id === e.item_id);
    return {
      'Pallet Code': plt ? plt.pallet_code : 'PLT',
      'Pallet Status': plt ? plt.status.toUpperCase() : 'UNKNOWN',
      'Product Code': sku ? sku.sku_code : '---',
      'Product Description': sku ? sku.product_name : '',
      'UOM': sku?.uom || 'EA',
      'Boxes Counted': e.cartons_counted,
      'Pack Size': e.pack_size_used,
      'Partial Box Loose Pcs': e.partial_carton_qty || 0,
      'Good Qty': e.good_qty,
      'QC Damaged Qty': e.damaged_qty,
      'Pack Override Reason': e.pack_override_reason || 'NONE',
      'QC Reason Code': e.qc_reason_code,
      'QC Remarks': e.qc_remarks || '',
      'Operator': e.operator_name,
      'Timestamp': new Date(e.created_at).toLocaleString(),
    };
  });
  const ledgerWs = XLSX.utils.json_to_sheet(ledgerRows);
  XLSX.utils.book_append_sheet(wb, ledgerWs, 'Pallet Breakdown');

  // 4. SHEET 4: QC Discrepancies & Defect Log
  const defectEntries = validEntries.filter((e) => Number(e.damaged_qty) > 0 || e.qc_reason_code !== 'PASS');
  const defectRows = defectEntries.map((e) => {
    const plt = pallets.find((p) => p.id === e.pallet_id);
    const sku = items.find((i) => i.id === e.item_id);
    return {
      'Pallet Code': plt ? plt.pallet_code : 'PLT',
      'Product Code': sku ? sku.sku_code : '---',
      'Product Description': sku ? sku.product_name : '',
      'Defect Units': e.damaged_qty,
      'Defect Reason Code': e.qc_reason_code,
      'Inspector Remarks': e.qc_remarks || 'No detailed remarks entered',
      'Operator': e.operator_name,
      'Logged At': new Date(e.created_at).toLocaleString(),
    };
  });
  const defectWs = XLSX.utils.json_to_sheet(
    defectRows.length > 0 ? defectRows : [{ Status: 'Zero physical defects recorded during receiving.' }]
  );
  XLSX.utils.book_append_sheet(wb, defectWs, 'QC Discrepancies');

  const cleanFilename = `GRN_${container.container_number.replace(/[^A-Z0-9]/gi, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, cleanFilename);
}

/**
 * Generates a Consolidated Multi-Container Consignment GRN Workbook (.xlsx)
 */
export function exportConsolidatedConsignmentGrnToExcel(
  consignment: Consignment,
  containers: Container[],
  allItems: ExpectedItem[],
  allPallets: Pallet[],
  allEntries: PalletEntry[]
): void {
  const wb = XLSX.utils.book_new();
  const validEntries = allEntries.filter((e) => !e.is_voided);

  const totalExpected = allItems.reduce((s, i) => s + (Number(i.expected_total_qty) || 0), 0);
  const totalGood = validEntries.reduce((s, e) => s + (Number(e.good_qty) || 0), 0);
  const totalDamaged = validEntries.reduce((s, e) => s + (Number(e.damaged_qty) || 0), 0);
  const totalCounted = totalGood + totalDamaged;

  // 1. SHEET 1: Consignment Master Overview
  const summaryData = [
    ['INWARDSFLOW ENTERPRISE WMS â€” CONSOLIDATED CONSIGNMENT GRN AUDIT REPORT'],
    ['MULTI-CONTAINER DE-VANNING & COMMERCIAL RECONCILIATION SUMMARY'],
    [],
    ['CONSIGNMENT METADATA', 'VALUE'],
    ['Consignment Reference', consignment.consignment_ref],
    ['Supplier / Shipper', consignment.supplier_name || 'General Inbound'],
    ['Arrival Mode', consignment.arrival_type],
    ['Consignment Status', consignment.status],
    ['Total Container / Arrival Units', containers.length],
    ['Total Pallets Generated Across Consignment', allPallets.length],
    ['Total Consignment Expected Units', totalExpected],
    ['Total Good Units Received', totalGood],
    ['Total QC Damaged Units', totalDamaged],
    ['Consolidated Net Physical Variance', totalCounted - totalExpected],
    ['Consignment Notes', consignment.notes || 'N/A'],
    ['Report Export Timestamp', new Date().toISOString()],
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Consignment Summary');

  // 2. SHEET 2: Consolidated SKU Reconciliation (Aggregate across all containers)
  const skuGroupMap = new Map<string, { sku: ExpectedItem; good: number; damaged: number; expected: number }>();
  for (const it of allItems) {
    const key = it.sku_code.toUpperCase();
    const existing = skuGroupMap.get(key) || { sku: it, good: 0, damaged: 0, expected: 0 };
    existing.expected += Number(it.expected_total_qty) || 0;
    skuGroupMap.set(key, existing);
  }

  for (const e of validEntries) {
    const it = allItems.find((i) => i.id === e.item_id);
    if (it) {
      const key = it.sku_code.toUpperCase();
      const existing = skuGroupMap.get(key);
      if (existing) {
        existing.good += Number(e.good_qty) || 0;
        existing.damaged += Number(e.damaged_qty) || 0;
      }
    }
  }

  const skuRows = Array.from(skuGroupMap.values()).map(({ sku, good, damaged, expected }) => {
    const received = good; // Phase 5: received = good only
    const diff = received - expected;
    return {
      'Product Code': sku.sku_code,
      'Product Description': sku.product_name,
      'Priority Stock': sku.is_priority ? 'YES (PRIORITY)' : 'NO',
      'UOM': sku.uom || 'EA',
      'Standard Pack Size': sku.pack_size,
      'Consolidated Expected Qty': expected,
      'Consolidated Good Received': good,
      'Consolidated Damaged': damaged,
      'Total Received': received,
      'Net Variance': diff === 0 ? 'MATCHED (0)' : diff > 0 ? `+${diff}` : String(diff),
      'Reconciliation Status': diff === 0 ? 'MATCHED' : diff > 0 ? 'OVERCOUNT' : 'SHORTAGE',
    };
  });
  const skuWs = XLSX.utils.json_to_sheet(skuRows);
  XLSX.utils.book_append_sheet(wb, skuWs, 'Consolidated SKU GRN');

  // 3. SHEET 3: Container Unit Breakdown
  const containerRows = containers.map((c) => {
    const cItems = allItems.filter((i) => i.container_id === c.id);
    const cEntries = validEntries.filter((e) => e.container_id === c.id);
    const exp = cItems.reduce((s, i) => s + (Number(i.expected_total_qty) || 0), 0);
    const rec = cEntries.reduce((s, e) => s + (Number(e.good_qty) || 0), 0); // Phase 5: good only
    return {
      'Sequence': `Unit ${c.sequence_index || 1}`,
      'Container Number': c.container_number,
      'Arrival Type': c.arrival_type || 'CONTAINER',
      'Size': c.container_size || '40HC',
      'Dock Door': c.dock_door || 'N/A',
      'Assigned Operator': toCleanUserId(c.assigned_operator_user_id || 'ALL'),
      'Status': c.status.toUpperCase(),
      'Shortage Disposition': c.shortage_disposition || 'NONE',
      'Expected Units': exp,
      'Received Units': rec,
      'Variance': rec - exp,
    };
  });
  const containerWs = XLSX.utils.json_to_sheet(containerRows);
  XLSX.utils.book_append_sheet(wb, containerWs, 'Container Units');

  // 4. SHEET 4: Complete Pallet Ledger
  const ledgerRows = validEntries.map((e) => {
    const plt = allPallets.find((p) => p.id === e.pallet_id);
    const cont = containers.find((c) => c.id === e.container_id);
    const sku = allItems.find((i) => i.id === e.item_id);
    return {
      'Container Unit': cont?.container_number || 'UNKNOWN',
      'Pallet Code': plt ? plt.pallet_code : 'PLT',
      'Product Code': sku ? sku.sku_code : '---',
      'Product Description': sku ? sku.product_name : '',
      'Boxes Counted': e.cartons_counted,
      'Pack Size': e.pack_size_used,
      'Good Qty': e.good_qty,
      'Damaged Qty': e.damaged_qty,
      'Pack Override Reason': e.pack_override_reason || 'NONE',
      'QC Defect Code': e.qc_reason_code,
      'Operator': e.operator_name,
      'Timestamp': new Date(e.created_at).toLocaleString(),
    };
  });
  const ledgerWs = XLSX.utils.json_to_sheet(ledgerRows);
  XLSX.utils.book_append_sheet(wb, ledgerWs, 'Consolidated Pallet Ledger');

  const filename = `CONSOLIDATED_GRN_${consignment.consignment_ref.replace(/[^A-Z0-9]/gi, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}
