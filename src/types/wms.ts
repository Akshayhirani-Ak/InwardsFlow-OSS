// InwardsFlow Enterprise WMS â€” Type Definitions
// InwardsFlow Receiving & Inventory Engine

export type UserRole = 'master_admin' | 'inwards_operator';

export interface UserProfile {
  id: string;
  user_id: string; // Clean corporate User ID (e.g. 'user1')
  email: string;   // Internal auth identifier
  full_name: string;
  role: UserRole;
  is_active?: boolean;
  perm_full_access: boolean;
  perm_ai_intake: boolean;
  perm_view_all_containers: boolean;
  perm_void_entries: boolean;
  perm_export_reports: boolean;
  created_at: string;
  updated_at: string;
}

export type PermissionKey =
  | 'full_access'
  | 'ai_intake'
  | 'view_all_containers'
  | 'void_entries'
  | 'export_reports';

export type ArrivalType = 'CONTAINER' | 'PALLET_FREIGHT' | 'COURIER_PARCEL';

export type ConsignmentStatus = 'active' | 'completed' | 'paused';

export interface Consignment {
  id: string;
  consignment_ref: string; // e.g. PO-8821 or BL-9901
  supplier_name: string | null;
  arrival_type: ArrivalType;
  status: ConsignmentStatus;
  total_containers: number;
  notes?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export type ContainerStatus = 'active' | 'paused' | 'completed';

export type ContainerSize = '20FT' | '40FT' | '40HC' | 'LCL';

export type CountingMode = 'GUIDED' | 'BLIND';

export type ShortageDisposition =
  | 'SPLIT_DELIVERY'
  | 'TRUE_SHORTAGE'
  | 'PENDING_INVESTIGATION'
  | 'IN_TRANSIT_SPLIT'
  | 'SUPPLIER_SHORTAGE';

export interface Container {
  id: string;
  consignment_id?: string | null;
  sequence_index?: number; // 1, 2, 3 in a multi-container consignment
  total_sequence?: number; // e.g. Container 1 of 3
  arrival_type?: ArrivalType;
  container_number: string;
  supplier_name: string | null;
  status: ContainerStatus;
  container_size?: ContainerSize;
  document_ref?: string | null;
  dock_door?: string | null;
  counting_mode?: CountingMode;
  completion_percentage: number;
  assigned_operator_user_id: string; // Clean User ID or 'ALL'
  assigned_operator_email?: string | null;
  pause_reason?: string | null;
  shortage_disposition?: ShortageDisposition | null;
  /** Phase 23: digital sign-off captured at finalize (both mandatory). */
  received_by_name?: string | null;
  checked_by_name?: string | null;
  deleted_at?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export type PackConfidence = 'AUTO_LEARNED' | 'VERIFIED' | 'VARIABLE';

export interface ProductMaster {
  id: string;
  sku_code: string;
  product_name: string;
  category?: string | null;
  uom: string;
  standard_pack_size: number;
  inner_pack_note?: string | null;
  pack_confidence: PackConfidence;
  times_received: number;
  is_default_priority: boolean;
  created_at: string;
  updated_at: string;
}

export interface SkuAlias {
  id: string;
  supplier_name: string;
  supplier_sku_code: string;
  master_sku_code: string;
  created_at: string;
}

export interface ExpectedItem {
  id: string;
  container_id: string;
  sku_code: string;
  /** Phase 11: the alternate code from the supplier document (their
   * internal code, or the barcode when the product is keyed by the
   * supplier code). Scan/search matches either code. */
  supplier_sku_code?: string | null;
  product_name: string;
  expected_cartons: number;
  pack_size: number;
  expected_total_qty: number;
  partial_cartons?: number; // Number of partial boxes (usually 0 or 1)
  expected_partial_qty?: number; // Pieces in partial box (e.g. 50 pcs in half box)
  uom?: string;
  is_priority?: boolean; // Priority stock segregation flag
  is_unlisted_addition?: boolean;
  shortage_disposition?: ShortageDisposition | null;
  created_at?: string;
}

export type PalletStatus = 'open' | 'sealed';

export interface Pallet {
  id: string;
  container_id: string;
  pallet_code: string; // e.g. PLT-001 or COURIER-BENCH
  status: PalletStatus;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
}

export type QcStatus = 'PASS' | 'DAMAGED' | 'HOLD';

export type QcReasonCode =
  | 'PASS'
  | 'PHYSICAL_DAMAGE'
  | 'WATER_DAMAGE'
  | 'MANUFACTURING_DEFECT'
  | 'WRONG_SKU_SENT'
  | 'PACKAGING_TORN'
  | 'QUARANTINE_HOLD';

export type PackOverrideReason =
  | 'PARTIAL_HALF_BOX'
  | 'INNER_BOX_SHORTAGE'
  | 'PACK_SIZE_CHANGED';

export interface PalletEntry {
  id: string;
  container_id: string;
  pallet_id: string;
  item_id: string;
  cartons_counted: number;
  pack_size_used: number;
  partial_carton_qty?: number; // Extra pieces in a partial/half box
  good_qty: number;
  damaged_qty: number;
  qc_status: QcStatus;
  qc_reason_code: QcReasonCode | string;
  qc_remarks?: string | null;
  pack_override_reason?: PackOverrideReason | string | null;
  damage_photo_urls?: string[]; // Phase 8: storage paths in the damage-photos bucket
  operator_id?: string | null;
  operator_user_id?: string | null;
  operator_name: string;
  is_voided: boolean;
  voided_by_name?: string | null;
  void_reason?: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  container_id?: string | null;
  consignment_id?: string | null;
  actor_id?: string | null;
  actor_user_id: string;
  actor_email?: string | null;
  actor_name: string;
  action_type: string;
  details: string;
  created_at: string;
}

export interface ContainerMetrics {
  skuCount: number;
  palletCount: number;
  expectedTotal: number;
  goodTotal: number;
  damagedTotal: number;
  countedTotal: number;
  pct: number;
}

export interface StagedManifestItem {
  sku_code: string;
  /** Phase 11: verified barcode (EAN/GTIN) when the document carries one.
   * When present and valid, sku_code IS this barcode. */
  barcode?: string;
  /** Phase 11: the supplier's own internal article code (identcode) when it
   * differs from sku_code. Kept as an alias so either code matches. */
  supplier_code?: string;
  product_name: string;
  expected_cartons: number;
  pack_size: number;
  expected_total_qty: number;
  partial_cartons?: number;
  expected_partial_qty?: number;
  container_sequence?: number; // For multi-container allocation
  uom?: string;
  is_priority?: boolean;
  ai_flag?: 'OK' | 'CHECK_HANDWRITING_OR_MATH';
}

/** Phase 25: the totals a supplier document itself prints (summary/footer).
 * Any figure may be absent â€” only printed figures are ever cross-checked. */
export interface PrintedTotals {
  lines?: number;
  cartons?: number;
  units?: number;
}

export interface AiExtractionContainer {
  container_number: string;
  container_size?: ContainerSize;
  document_ref?: string;
  /** Phase 24: the buyer's PO number this unit's document stated. */
  po_number?: string;
  /** Phase 25: printed totals summed across this unit's documents. */
  printed_totals?: PrintedTotals;
  dock_door?: string;
  counting_mode?: CountingMode;
}

export interface AiDocumentExtractionResponse {
  consignment_ref?: string;
  /** Phase 24: the buyer's PO number the document stated (names the consignment). */
  po_number?: string;
  /** Phase 25: the totals this document itself prints, when it states any. */
  printed_totals?: PrintedTotals;
  arrival_type?: ArrivalType;
  suggested_arrival_type?: ArrivalType;
  supplier_name: string;
  container_number: string;
  container_size?: ContainerSize;
  document_ref?: string;
  dock_door?: string;
  counting_mode?: CountingMode;
  items: StagedManifestItem[];
  /** Phase 13: present when several documents merged into several containers. */
  containers?: AiExtractionContainer[];
  /** Phase 13: non-fatal extraction problems the operator should check. */
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Phase 29: purchase orders. The company PO, uploaded once, living in the
// app as an open balance that deliveries draw down.
// ---------------------------------------------------------------------------

export interface StagedPoLine {
  product_code: string;
  supplier_code?: string;
  description: string;
  uom?: string;
  ordered_qty: number;
}

export interface AiPurchaseOrderResponse {
  kind: 'purchase_order';
  po_number: string;
  supplier_name: string;
  /** ISO date (YYYY-MM-DD) or '' when the document states none. */
  order_date?: string;
  lines: StagedPoLine[];
  warnings?: string[];
}

export type PurchaseOrderStatus = 'OPEN' | 'CLOSED';

export interface PurchaseOrderSummary {
  id: string;
  po_number: string;
  supplier_name: string | null;
  order_date: string | null;
  status: PurchaseOrderStatus;
  lines_total: number;
  ordered_total: number;
  received_total: number;
  remaining_total: number;
  deliveries: number;
  updated_at: string;
}

export interface PoLineReceipt {
  container_id: string;
  container_number: string;
  qty: number;
  created_at: string;
}

export interface PurchaseOrderLine {
  id: string;
  line_index: number;
  product_code: string;
  supplier_code: string | null;
  description: string | null;
  uom: string;
  ordered_qty: number;
  received_qty: number;
  remaining_qty: number;
  closed_at: string | null;
  closed_reason: string | null;
  closed_by_name: string | null;
  receipts: PoLineReceipt[];
}

export interface PoDeliveryContainer {
  id: string;
  container_number: string;
  status: ContainerStatus;
  counted_good: number;
  allocated: number;
}

export interface PoDelivery {
  consignment_id: string;
  consignment_ref: string;
  containers: PoDeliveryContainer[];
}

export interface PurchaseOrderDetail {
  id: string;
  po_number: string;
  supplier_name: string | null;
  order_date: string | null;
  status: PurchaseOrderStatus;
  closed_reason: string | null;
  closed_at: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
  lines: PurchaseOrderLine[];
  deliveries: PoDelivery[];
}
