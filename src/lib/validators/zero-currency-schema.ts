// InwardsFlow Enterprise WMS â€” Zero-Currency Zod Validators
// InwardsFlow Receiving & Inventory Engine
import { z } from 'zod';

const CURRENCY_REGEX = /(?:USD|NZD|AUD|EUR|GBP|INR|CAD|CNY|JPY|CHF|\$|â‚¬|Â£|â‚¹|Â¥)/i;

/**
 * Strips currency marks and price traces from any string.
 */
function sanitizeZeroDollarString(val: string): string {
  return val
    .replace(/(?:USD|NZD|AUD|EUR|GBP|INR|CAD|CNY|JPY|CHF|\$|â‚¬|Â£|â‚¹|Â¥)/gi, '')
    .replace(/\[PRICE_REDACTED\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const StagedItemSchema = z.object({
  sku_code: z
    .string()
    .min(1, 'SKU code is required')
    .transform(sanitizeZeroDollarString)
    .refine((v) => !CURRENCY_REGEX.test(v), { message: 'Monetary symbols are strictly forbidden in SKU codes' }),
  product_name: z
    .string()
    .min(1, 'Product name is required')
    .transform(sanitizeZeroDollarString),
  barcode: z.string().optional().default(''),
  supplier_code: z
    .string()
    .optional()
    .default('')
    .transform(sanitizeZeroDollarString),
  expected_cartons: z.coerce.number().int().nonnegative().default(0),
  pack_size: z.coerce.number().int().positive().default(1),
  expected_total_qty: z.coerce.number().int().nonnegative(),
  partial_cartons: z.coerce.number().int().nonnegative().optional().default(0),
  expected_partial_qty: z.coerce.number().int().nonnegative().optional().default(0),
  container_sequence: z.coerce.number().int().positive().optional().default(1),
  uom: z.string().optional().default('EA'),
  is_priority: z.boolean().optional().default(false),
  ai_flag: z.enum(['OK', 'CHECK_HANDWRITING_OR_MATH']).optional().default('OK'),
});

export const ContainerManifestSchema = z.object({
  consignment_ref: z.string().optional().default(''),
  po_number: z.string().optional().default(''),
  printed_totals: z
    .object({
      lines: z.number().optional(),
      cartons: z.number().optional(),
      units: z.number().optional(),
    })
    .optional(),
  arrival_type: z.enum(['CONTAINER', 'PALLET_FREIGHT', 'COURIER_PARCEL']).optional().default('CONTAINER'),
  container_number: z
    .string()
    .min(3, 'Container number must be at least 3 characters')
    .transform((v) => v.toUpperCase().trim()),
  supplier_name: z.string().default('General Inbound').transform(sanitizeZeroDollarString),
  container_size: z.enum(['20FT', '40FT', '40HC', 'LCL']).optional().default('40HC'),
  document_ref: z.string().optional().default(''),
  dock_door: z.string().optional().default(''),
  counting_mode: z.enum(['GUIDED', 'BLIND']).optional().default('GUIDED'),
  items: z.array(StagedItemSchema).min(1, 'At least one line item is required in the manifest'),
});

export const PalletEntryInputSchema = z.object({
  good_qty: z.coerce.number().int().nonnegative().default(0),
  damaged_qty: z.coerce.number().int().nonnegative().default(0),
  qc_reason: z.string().default('PASS'),
  qc_remarks: z.string().optional().default(''),
  cartons: z.coerce.number().int().nonnegative().default(0),
  pack_size: z.coerce.number().int().positive().default(1),
}).refine(
  (data) => data.good_qty > 0 || data.damaged_qty > 0,
  { message: 'You must specify at least 1 Good unit or 1 Damaged unit to record a pallet tally.' }
);

export const OperatorProvisionInputSchema = z.object({
  user_id: z
    .string()
    .min(3, 'User ID must be at least 3 characters')
    .max(32, 'User ID must be 32 characters or less')
    .regex(/^[a-zA-Z0-9._-]+$/, 'User ID can only contain letters, numbers, dot, dash, and underscore')
    .refine((v) => !v.includes('@'), { message: 'User ID cannot contain an @ symbol' }),
  full_name: z.string().min(2, 'Full Name is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  perm_full_access: z.boolean().default(false),
  perm_ai_intake: z.boolean().default(false),
  perm_view_all_containers: z.boolean().default(false),
  perm_void_entries: z.boolean().default(false),
  perm_export_reports: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Phase 29: purchase-order extraction (the buyer's own order document).
// A PO line carries the ORDER quantity only â€” any "Received" figure on the
// printout is a snapshot of earlier deliveries and is never extracted.
// ---------------------------------------------------------------------------
export const PoLineSchema = z.object({
  product_code: z
    .string()
    .min(1, 'Product code is required')
    .transform(sanitizeZeroDollarString)
    .refine((v) => !CURRENCY_REGEX.test(v), { message: 'Monetary symbols are strictly forbidden in product codes' }),
  supplier_code: z
    .string()
    .optional()
    .default('')
    .transform(sanitizeZeroDollarString),
  description: z
    .string()
    .optional()
    .default('')
    .transform(sanitizeZeroDollarString),
  uom: z.string().optional().default('EA'),
  ordered_qty: z.coerce.number().int().nonnegative(),
});

export const PurchaseOrderExtractionSchema = z.object({
  po_number: z.string().optional().default(''),
  supplier_name: z.string().optional().default('').transform(sanitizeZeroDollarString),
  order_date: z.string().optional().default(''),
  lines: z.array(PoLineSchema).optional().default([]),
});
