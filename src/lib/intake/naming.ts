// InwardsFlow — Phase 24 PO naming (pure, unit-tested).
//
// The consignment's name is its PO number (floor ruling, 2026-11-20):
// the AI reads the buyer's purchase order number off the supplier's
// documents and the consignment is filed under it, so searching a PO
// number finds the delivery and everything received against it. A
// delivery spanning several POs is named by all of them, in document
// order. The container number stays a secondary field, filled by the AI
// when the document states one — it is never the record's name.

/**
 * Normalise a raw extracted PO number. Buyer PO numbers are short
 * alphanumeric references (typically 7 digits, e.g. 1234567). Anything
 * with spaces, punctuation beyond - and /, or an implausible length is
 * treated as not-a-PO-number and dropped to '' — a wrong name is worse
 * than the document-ref fallback.
 */
export function cleanPoNumber(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const v = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (v.length < 4 || v.length > 20) return '';
  if (!/^[A-Z0-9][A-Z0-9\-/]*$/.test(v)) return '';
  return v;
}

interface PoCarrier {
  po_number?: string | null;
  containers?: Array<{ po_number?: string | null }> | null;
}

/** Every distinct PO number an extraction carries, in document order. */
export function collectPoNumbers(extraction: PoCarrier): string[] {
  const out: string[] = [];
  const push = (raw: unknown) => {
    const v = cleanPoNumber(raw);
    if (v && !out.includes(v)) out.push(v);
  };
  push(extraction.po_number);
  for (const c of extraction.containers || []) push(c.po_number);
  return out;
}

/**
 * The consignment's name: its PO number(s) when the documents stated
 * any, otherwise the fallback (today: the supplier document ref, and
 * the grid's generated PO-<stamp> when even that is empty).
 */
export function deriveConsignmentRef(poNumbers: string[], fallback: string): string {
  const clean = poNumbers.map((p) => cleanPoNumber(p)).filter(Boolean);
  const distinct = Array.from(new Set(clean));
  if (distinct.length === 0) return (fallback || '').trim();
  return distinct.join(' · ');
}
