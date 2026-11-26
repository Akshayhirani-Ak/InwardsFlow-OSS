// InwardsFlow — GS1-128 parsing + GTIN-14 conversion (pure, unit-tested).
//
// Supplier cartons (proven on real supplier outer labels)
// carry a GS1-128 barcode whose data is a chain of Application
// Identifiers: (02) + the 14-digit GTIN of the contents + (37) + the
// unit count, e.g. "(02)00010000000177(37)000020". A scanner hands the
// app that whole chain — it matches no product code as-is, so the scan
// failed even on the right box. These helpers pull the GTIN out of the
// chain, and convert a GTIN-14 to the EAN-13 of the single pack inside
// (drop the packaging indicator, recompute the check digit) — for the
// labels on the floor the indicator is 0 and the result is exactly the
// printed SINGLE PACK EAN.

import { gtinCheckDigit, isValidGtin, normalizeBarcode } from './gtin';

const FNC1 = '\u001D';

/** Fixed-length AIs the walk must step over correctly. */
const FIXED_AI: Record<string, number> = {
  '00': 18,
  '01': 14,
  '02': 14,
  '11': 6,
  '12': 6,
  '13': 6,
  '15': 6,
  '16': 6,
  '17': 6,
  '20': 2,
};

/** Variable-length AIs (terminated by FNC1 or end of string). */
const VARIABLE_AI = new Set([
  '10', '21', '22', '30', '37', '90', '91', '92', '93', '99',
  '240', '241', '250', '400', '402',
]);

export interface Gs1Data {
  /** The GTIN from AI (01) or (02), when present AND check-digit valid. */
  gtin?: string;
  /** The unit count from AI (37), when present. */
  count?: number;
}

function assignAi(out: Gs1Data, ai: string, value: string): void {
  if (ai === '01' || ai === '02') {
    const digits = normalizeBarcode(value);
    if (digits.length === 14 && isValidGtin(digits) && !out.gtin) {
      out.gtin = digits;
    }
  } else if (ai === '37') {
    const n = parseInt(value, 10);
    if (Number.isFinite(n) && n > 0 && out.count == null) out.count = n;
  }
}

export function parseGs1(rawInput: string): Gs1Data {
  const raw = (rawInput || '').trim();
  if (!raw) return {};

  // Parenthesised human-readable form: (02)00010000000177(37)000020
  if (raw.includes('(')) {
    const out: Gs1Data = {};
    const re = /\((\d{2,4})\)([^(]*)/g;
    let m: RegExpExecArray | null;
    let any = false;
    while ((m = re.exec(raw)) !== null) {
      any = true;
      assignAi(out, m[1], m[2].replace(/[^0-9A-Za-z]/g, ''));
    }
    return any ? out : {};
  }

  // Raw scanner form: AIs concatenated, FNC1 between variable fields.
  // Only attempted when the string opens with a GTIN AI — a plain long
  // number is not GS1 and must not be mangled.
  const body = raw.startsWith(']C1') ? raw.slice(3) : raw;
  if (!body.startsWith('01') && !body.startsWith('02')) return {};

  const out: Gs1Data = {};
  let i = 0;
  while (i < body.length) {
    if (body[i] === FNC1) {
      i++;
      continue;
    }
    let ai = body.slice(i, i + 2);
    let aiLen = 2;
    const three = body.slice(i, i + 3);
    if (VARIABLE_AI.has(three)) {
      ai = three;
      aiLen = 3;
    }
    if (FIXED_AI[ai] != null) {
      const len = FIXED_AI[ai];
      assignAi(out, ai, body.slice(i + aiLen, i + aiLen + len));
      i += aiLen + len;
    } else if (VARIABLE_AI.has(ai)) {
      const rest = body.slice(i + aiLen);
      const sep = rest.indexOf(FNC1);
      const val = sep === -1 ? rest : rest.slice(0, sep);
      assignAi(out, ai, val);
      i += aiLen + val.length;
    } else {
      break; // Unknown AI — stop; keep whatever was already extracted.
    }
  }
  return out;
}

/**
 * GTIN-14 → the EAN-13 of the unit inside: drop the packaging indicator
 * (first digit) and recompute the check digit over the 12 data digits.
 * Returns null for anything that isn't a check-digit-valid GTIN-14.
 */
export function gtin14ToEan13(gtin14: string): string | null {
  const n = normalizeBarcode(gtin14);
  if (n.length !== 14 || !isValidGtin(n)) return null;
  const data = n.slice(1, 13);
  const ean = data + String(gtinCheckDigit(data));
  return isValidGtin(ean) ? ean : null;
}
