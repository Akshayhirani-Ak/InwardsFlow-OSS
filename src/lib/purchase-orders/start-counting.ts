// Phase 37: "Start counting" from a purchase order.
//
// Builds the publish_consignment payload for a receiving session whose
// counting list IS the PO's still-owed balance. The consignment is filed
// under the PO number (po_numbers), so when the session is finalised the
// existing Phase 29 drawdown banks the counted good units against the
// PO lines. Lines the supplier did not send are simply never counted —
// they stay owed on the PO; finalising completes the delivery, never
// the PO (the PO closes only when every line is received or
// short-closed).

import type { PurchaseOrderDetail, PurchaseOrderLine } from '@/types/wms';

export interface PoCountingItem {
  sku_code: string;
  supplier_code: string | null;
  product_name: string;
  expected_cartons: number;
  pack_size: number;
  expected_partial_qty: number;
  partial_cartons: number;
  uom: string;
  is_priority: boolean;
}

/** The lines a new delivery can still receive against: open and owed. */
export function owedLines(po: PurchaseOrderDetail): PurchaseOrderLine[] {
  return po.lines.filter((l) => !l.closed_at && l.remaining_qty > 0);
}

/**
 * One expected item per owed line, expecting exactly the still-owed
 * quantity. The catalog's learned pack size splits the quantity into
 * full cartons + at most one partial (the expected_items CHECK requires
 * expected_partial_qty <= pack_size, so a remainder is always < pack).
 * Unknown or unit packs fall back to pack 1 — cartons of one.
 */
export function buildPoCountingItems(
  po: PurchaseOrderDetail,
  packSizes: ReadonlyMap<string, number>,
): PoCountingItem[] {
  return owedLines(po).map((line) => {
    const learned = packSizes.get(line.product_code);
    const pack =
      typeof learned === 'number' && Number.isInteger(learned) && learned > 1
        ? learned
        : 1;
    const cartons = Math.floor(line.remaining_qty / pack);
    const partial = line.remaining_qty % pack;
    return {
      sku_code: line.product_code,
      supplier_code: line.supplier_code,
      product_name: line.description || line.product_code,
      expected_cartons: cartons,
      pack_size: pack,
      expected_partial_qty: partial,
      partial_cartons: partial > 0 ? 1 : 0,
      uom: line.uom || 'EA',
      is_priority: false,
    };
  });
}

/**
 * The full publish_consignment payload for a PO counting session.
 * deliverySeq distinguishes successive deliveries against the same PO
 * (pass the count of deliveries already filed, + 1).
 */
export function buildPoCountingPayload(
  po: PurchaseOrderDetail,
  packSizes: ReadonlyMap<string, number>,
  deliverySeq: number,
) {
  return {
    consignment_ref: po.po_number,
    supplier_name: po.supplier_name || 'General Supplier',
    arrival_type: 'PALLET_FREIGHT',
    notes:
      'Counting session started from the PO screen — count what has ' +
      'arrived; anything not counted stays owed on the PO.',
    po_numbers: [po.po_number],
    containers: [
      {
        sequence_index: 1,
        container_number: `PO-${po.po_number}-${deliverySeq}`,
        container_size: 'LCL',
        document_ref: po.po_number,
        dock_door: null,
        counting_mode: 'GUIDED',
        items: buildPoCountingItems(po, packSizes),
      },
    ],
  };
}
