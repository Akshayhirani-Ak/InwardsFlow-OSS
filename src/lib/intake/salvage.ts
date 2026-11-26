// InwardsFlow — Phase 13 manifest salvage (pure, unit-tested).
//
// Before Phase 13 the AI intake validated the extracted manifest
// all-or-nothing: on a 30–40 line real-world document, ONE line with an
// off-enum flag or a missing total failed the entire extraction and the
// operator got no list at all. Salvage validates line by line instead:
// good lines stage, bad lines are dropped and REPORTED (line number +
// reason), and the header is normalized leniently with the same defaults
// the schema always had. Zero surviving lines is still a hard failure.

import type { z } from 'zod';
import {
  ContainerManifestSchema,
  StagedItemSchema,
} from '@/lib/validators/zero-currency-schema';
import { cleanPoNumber } from './naming';

type ContainerManifest = z.infer<typeof ContainerManifestSchema>;
type StagedItem = z.infer<typeof StagedItemSchema>;

export interface DroppedLine {
  line: number; // 1-based position in the extracted items array
  sku: string;
  reason: string;
}

export interface RepairedLine {
  line: number; // 1-based position in the extracted items array
  sku: string;
  note: string;
}

export interface SalvageResult {
  manifest: ContainerManifest | null;
  dropped: DroppedLine[];
  repaired: RepairedLine[];
}

const CONTAINER_SIZES = ['20FT', '40FT', '40HC', 'LCL'];
const ARRIVAL_TYPES = ['CONTAINER', 'PALLET_FREIGHT', 'COURIER_PARCEL'];
const COUNTING_MODES = ['GUIDED', 'BLIND'];

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function normalizeHeader(raw: Record<string, unknown>): Record<string, unknown> {
  const header: Record<string, unknown> = { ...raw };
  const cn = typeof raw.container_number === 'string' ? raw.container_number.trim() : '';
  header.container_number = cn.length >= 3 ? cn : 'CONT-PENDING';
  // Phase 24: the buyer's PO number names the consignment — keep only a
  // plausible one; junk drops to '' and naming falls back to the doc ref.
  header.po_number = cleanPoNumber(raw.po_number);
  // Phase 25: the document's own printed totals, cleaned figure by
  // figure — a figure survives only as a positive whole number (the same
  // near-integer repair as line quantities); anything else is treated as
  // "not printed" and never cross-checked.
  const pt = asRecord(raw.printed_totals);
  const cleanedTotals: Record<string, number> = {};
  for (const f of ['lines', 'cartons', 'units']) {
    const v = Number(pt[f]);
    if (Number.isFinite(v) && v > 0 && Math.abs(v - Math.round(v)) <= 0.01) {
      cleanedTotals[f] = Math.round(v);
    }
  }
  if (Object.keys(cleanedTotals).length > 0) {
    header.printed_totals = cleanedTotals;
  } else {
    delete header.printed_totals;
  }
  if (!CONTAINER_SIZES.includes(String(raw.container_size))) {
    delete header.container_size; // schema default 40HC applies
  }
  if (!ARRIVAL_TYPES.includes(String(raw.arrival_type))) {
    delete header.arrival_type;
  }
  if (!COUNTING_MODES.includes(String(raw.counting_mode))) {
    delete header.counting_mode;
  }
  return header;
}

const QTY_FIELDS = ['expected_cartons', 'pack_size', 'expected_total_qty'];
// Phase 17: the half-box breakdown fields are integers in the schema too —
// a float landing there produced the same "Expected integer" drop while
// the Phase 16 repair only watched the three main fields.
const PARTIAL_FIELDS = ['partial_cartons', 'expected_partial_qty'];

function repairQuantities(item: Record<string, unknown>): string | null {
  // Phase 16/17/18: the model sometimes returns a whole quantity as a
  // decimal (rounding noise like 24.999999, or a ratio artefact like a
  // pack size of 0.33 for 24 units in 8 cartons), and the strict integer
  // schema then dropped a genuine line. Repair what's provable:
  //   * near-integer values (within 0.01) round to the integer — silent,
  //     it is the same count;
  //   * when EXACTLY ONE of cartons/pack/total is still fractional and
  //     the other two pin it by exact arithmetic (Phase 18), derive it —
  //     and REPORT the repair so the operator checks that line;
  //   * a NON-UNIFORM pack (Phase 19: the document states cartons and
  //     total that don't divide evenly — 30 units over 8 boxes) is
  //     staged via the half-box fields when it has the clean shape of
  //     full cartons + ONE remainder box: the document's printed
  //     cartons and total stay exact, and the repair is reported;
  //   * anything else (two fractional fields, mixed packs) is a real
  //     discrepancy: leave it for the schema to drop WITH the
  //     field-named warning rather than guessing a count.
  for (const f of QTY_FIELDS) {
    const v = Number(item[f]);
    if (Number.isFinite(v) && Math.abs(v - Math.round(v)) <= 0.01) {
      item[f] = Math.round(v);
    }
  }
  for (const f of PARTIAL_FIELDS) {
    if (item[f] === undefined) continue;
    const v = Number(item[f]);
    if (Number.isFinite(v) && Math.abs(v - Math.round(v)) <= 0.01) {
      item[f] = Math.round(v);
    }
  }
  const cartons = Number(item.expected_cartons);
  const pack = Number(item.pack_size);
  const total = Number(item.expected_total_qty);
  const frac = (v: number) => Number.isFinite(v) && !Number.isInteger(v);
  const fracCount = [cartons, pack, total].filter(frac).length;
  if (fracCount === 0) {
    // Phase 36: all three figures are whole numbers but they DISAGREE —
    // the model returned a pack size that does not multiply to the
    // printed total (live case 22 Nov 2026: 13 units in 2 cartons at
    // "6 per carton" staged as 12 — one unit silently lost). The
    // PRINTED TOTAL governs: re-derive the pack from cartons + total
    // and stage full cartons + one partial, the Phase 19 shape. The
    // repair is reported and the line is flagged for a human check.
    const partialsClear =
      !Number(item.partial_cartons) && !Number(item.expected_partial_qty);
    if (partialsClear && cartons > 0 && pack > 0 && total > 0 && cartons * pack !== total) {
      const derivedPack = Math.ceil(total / cartons);
      const full = Math.floor(total / derivedPack);
      const rem = total - full * derivedPack;
      if (rem === 0 && full === cartons) {
        item.pack_size = derivedPack;
        return `pack size set to ${derivedPack} from ${total} units ÷ ${cartons} cartons — the stated pack of ${pack} did not multiply to the printed total of ${total}, which was kept`;
      }
      if (rem === 0 && full >= 1) {
        item.pack_size = derivedPack;
        item.expected_cartons = full;
        return `cartons set to ${full} at ${derivedPack} per carton — ${total} units fill only ${full} of the ${cartons} stated cartons at the stated pack of ${pack}; the printed total of ${total} was kept, check this line`;
      }
      if (full >= 1) {
        item.pack_size = derivedPack;
        item.expected_cartons = full;
        item.partial_cartons = 1;
        item.expected_partial_qty = rem;
        const shape =
          full + 1 === cartons
            ? `${full} full cartons + 1 partial of ${rem}`
            : `${full} full cartons + 1 partial of ${rem} (${full + 1} cartons — the document states ${cartons}, check this line)`;
        return `pack size set to ${derivedPack} with ${shape} — ${cartons} cartons × ${pack} did not equal the printed total of ${total}, which was kept`;
      }
    }
    return null;
  }
  if (fracCount !== 1) return null;
  if (frac(total) && Number.isInteger(cartons) && Number.isInteger(pack)) {
    const derived = cartons * pack;
    item.expected_total_qty = derived;
    return `total quantity set to ${derived} from ${cartons} cartons × ${pack} per carton`;
  }
  if (frac(pack) && Number.isInteger(cartons) && Number.isInteger(total) && cartons > 0) {
    if (total % cartons === 0) {
      const derived = total / cartons;
      item.pack_size = derived;
      return `pack size set to ${derived} from ${total} units ÷ ${cartons} cartons`;
    }
    // Phase 19: non-uniform pack, clean shape only (see header note).
    const partialsClear = !Number(item.partial_cartons) && !Number(item.expected_partial_qty);
    if (partialsClear && total > cartons) {
      const packSize = Math.ceil(total / cartons);
      const full = Math.floor(total / packSize);
      const rem = total - full * packSize;
      if (full >= 1 && rem > 0 && full + 1 === cartons) {
        item.pack_size = packSize;
        item.expected_cartons = full;
        item.partial_cartons = 1;
        item.expected_partial_qty = rem;
        return `pack size set to ${packSize} with ${full} full cartons + 1 partial of ${rem} — ${total} units over ${cartons} cartons is not a uniform pack`;
      }
    }
    return null;
  }
  if (frac(cartons) && Number.isInteger(total) && Number.isInteger(pack) && pack > 0) {
    if (total % pack === 0) {
      const derived = total / pack;
      item.expected_cartons = derived;
      return `carton count set to ${derived} from ${total} units ÷ ${pack} per carton`;
    }
    // Phase 19 mirror: fractional carton count, whole pack and total —
    // stage full cartons + one remainder box, total stays exact.
    const partialsClear = !Number(item.partial_cartons) && !Number(item.expected_partial_qty);
    if (partialsClear && total > pack) {
      const full = Math.floor(total / pack);
      const rem = total - full * pack;
      if (full >= 1 && rem > 0) {
        item.expected_cartons = full;
        item.partial_cartons = 1;
        item.expected_partial_qty = rem;
        return `cartons set to ${full} full + 1 partial of ${rem} — ${total} units at ${pack} per carton does not divide evenly`;
      }
    }
    return null;
  }
  return null;
}

function normalizeItem(raw: Record<string, unknown>): {
  item: Record<string, unknown>;
  repairNote: string | null;
} {
  const item: Record<string, unknown> = { ...raw };
  // ai_flag is a strict enum in the schema; anything the model invented
  // that is not exactly OK reads as "check this line" rather than failing it.
  if (item.ai_flag !== 'OK' && item.ai_flag !== 'CHECK_HANDWRITING_OR_MATH') {
    item.ai_flag = item.ai_flag ? 'CHECK_HANDWRITING_OR_MATH' : 'OK';
  }
  const repairNote = repairQuantities(item);
  // A missing total is recoverable when cartons × pack is known.
  const total = Number(item.expected_total_qty);
  if (!Number.isFinite(total)) {
    const cartons = Number(item.expected_cartons);
    const pack = Number(item.pack_size);
    if (Number.isFinite(cartons) && Number.isFinite(pack) && pack > 0) {
      item.expected_total_qty = cartons * pack;
    }
  }
  return { item, repairNote };
}

export function salvageManifest(parsed: unknown): SalvageResult {
  const root = asRecord(parsed);
  const headerParsed = ContainerManifestSchema.omit({ items: true }).safeParse(
    normalizeHeader(root)
  );
  const rawItems = Array.isArray(root.items) ? root.items : [];

  const items: StagedItem[] = [];
  const dropped: DroppedLine[] = [];
  const repaired: RepairedLine[] = [];
  rawItems.forEach((rawItem, idx) => {
    const rec = asRecord(rawItem);
    const { item, repairNote } = normalizeItem(rec);
    const result = StagedItemSchema.safeParse(item);
    if (result.success) {
      // Phase 19: a derived line is flagged CHECK on the grid itself,
      // not only in the banner — the operator's eye goes to the row.
      if (repairNote) result.data.ai_flag = 'CHECK_HANDWRITING_OR_MATH';
      items.push(result.data);
      if (repairNote) {
        repaired.push({
          line: idx + 1,
          sku: typeof rec.sku_code === 'string' ? rec.sku_code : '',
          note: repairNote,
        });
      }
    } else {
      // Phase 17: name the failing field — "expected integer, received
      // float" alone sent diagnosis hunting through the schema; the
      // banner should say WHICH quantity was unreadable.
      const issue = result.error.issues[0];
      const field = issue?.path?.length ? issue.path.join('.') : '';
      dropped.push({
        line: idx + 1,
        sku: typeof rec.sku_code === 'string' ? rec.sku_code : '',
        reason: issue
          ? `${field ? `${field}: ` : ''}${issue.message}`
          : 'Unreadable line',
      });
    }
  });

  if (!headerParsed.success || items.length === 0) {
    return { manifest: null, dropped, repaired };
  }
  return { manifest: { ...headerParsed.data, items }, dropped, repaired };
}
