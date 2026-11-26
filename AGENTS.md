# InwardsFlow — Warehouse Receiving Application Knowledge Base & Rules

## The Product
InwardsFlow is a mission-critical goods-inwards receiving and counting application for a wholesale warehouse.
Stack: Next.js 14 (App Router, TypeScript) + Tailwind CSS, Supabase (Postgres with Row Level Security and SECURITY DEFINER RPCs as the only write path), Vercel hosting, Google Gemini for document extraction at intake.
Tests: Vitest (unit/component), Playwright (smoke), and SQL/pgTAP regression harnesses.

## How Receiving Actually Works Here (The App Mirrors the Floor, Never the Reverse)
1. **Supplier List First**: A delivery arrives with the supplier's packing list. Floor staff count against the supplier list first — never against the purchase order.
2. **ERP PO Matching**: Afterwards, counted quantities are matched to the company's purchase orders (POs) in the company ERP. A PO stays open across many deliveries (short-shipments, partials, split lines).
3. **Delivery vs PO**: Finalising completes a delivery container, NEVER the PO. Allocation of counted goods to PO lines is strictly oldest-PO-first (FIFO) unless the supplier's paperwork specifies the split.
4. **Counted Quantity is Truth**: Stock rises strictly by what was physically counted, never by what a document claims. Received = good units only. Damaged units are recorded separately and NEVER count as received.
5. **Money is Out of Scope**: No prices, claims, credit notes, or payment features. Warehouse provides a perfect physical record; accounts handles money elsewhere.
6. **Mandatory Sign-off Names**: At finalise, the app requires two distinct names — *Received by* and *Checked by*. The date fills automatically. No finalise without both names.
7. **Handover Sheet**: The printed Goods Received list is a handover sheet: it lists ONLY what was actually received, formatted like our ERP's PO printout. Variance/owed information lives in the app on the PO master balance, never on this sheet.

---

## NON-NEGOTIABLE Specs (Floor Rules — Do Not Change, Remove, or "Simplify")
1. **Counting Screen Layout**:
   - Counting pad on **TOP**, product list **BELOW** (desktop and mobile).
   - The screen itself **NEVER scrolls**; all counting controls remain on one fixed screen; only the product list scrolls.
   - The counting band must be short enough (target <=460px total top band) that the pallet strip and the first 2–3 product lines are visible on a 1366×800 laptop screen without scrolling.
2. **Damage UI Hidden by Default**:
   - Damage is rare: one collapsed row (`"Damage / QC — None, tap if any damaged"`).
   - Tapping opens the full damage controls.
   - The section stays open automatically while damaged units exist on the active tally.
   - Auto-collapses back to the collapsed single row when moving to an undamaged tally or switching products. Never return to an always-visible damage section.
3. **Guided Counting**:
   - Expected quantities are always visible.
   - Blind counting was researched and deliberately removed — NEVER reintroduce it anywhere.
4. **Multiply Quick Keys**:
   - Quick keys (`×2`, `×5`, `×10`, `+5`, `+10` boxes, and `= N (all remaining)`) must stay. Floor staff count stacks with them.
5. **Floor Vocabulary**:
   - **"boxes"**, never "cartons", in the UI, print, and exports.
   - **"Product Code"**, never "SKU", in the UI, print, and exports.
   - Internal code identifiers may remain as they are.
6. **Scan Behaviour**:
   - 1 scan = 1 box.
   - A scanned barcode is checked against the selected product; a wrong code NEVER counts — it displays the scanned product's real name and warns.
   - Scanning with nothing selected selects and counts that product.
   - GS1-128 codes are parsed (AI 02/01 GTIN, including GTIN-14 → EAN-13 conversion) before matching.
   - Code resolution order: `product code` → `manifest supplier code` → `alias map`.
7. **Pack-Size Learning Guard**:
   - A pack size is learned from finalised receipts ONLY when ONE pack size appears across at least 5 full boxes.
   - A product reaches `VERIFIED` status ONLY through the explicit master `catalog_verify_product` function.
   - Imports and auto-learning never stamp `VERIFIED`.
8. **Catalog Governance**:
   - Publish resolves canonical product code: `existing product` → `existing alias` → `verified GTIN wins` → `sent code`.
   - The losing code is stored as the manifest line's supplier code and auto-aliased, with guards (never alias a real product code, never a bad-check-digit GTIN, first mapping wins).
9. **Purchase Order Model**:
   - PO = cumulative master (ordered / received-to-date / still owed per line, stays open).
   - Delivery counted against supplier's list only; allocation happens at finalise, capped at line's remaining balance (excess reported as counted-beyond-PO, never negative, never silently absorbed).
   - A line is short-closed only by a master, with a mandatory reason.
   - PO closes itself when every line is received or short-closed, and reopens if a receipt is unwound.
   - Supplier invoice is never a counting source.
   - A PO document is filed once; re-uploading the same PO number must NOT touch its live balance.
10. **AI Intake Naming**:
    - Consignment is named by the buyer's PO number(s) detected on supplier paperwork ("Your order No." etc.), NEVER the supplier's own invoice number.
    - Container number is secondary, filled when paperwork has one; its absence never blocks anything.
11. **Printed-Totals Cross-Check**:
    - When a document prints its own totals, compare against staged lines at publish.
    - Mismatch warns and requires a typed override reason written into the record. It is a warning, NEVER a hard block.
12. **Finalise Guards**:
    - Refuse while the counting device holds un-synced offline tallies for that container.
    - Received-by and Checked-by names are mandatory.
    - Reopening a finalised container is master-only (within 24h, with mandatory reason, and unwinds pack-size learning).
13. **Design System ("Ledger")**:
    - Flat surfaces, 1px hairline dividers, no card soup, no shadows on resting elements, no gradients.
    - Fonts: IBM Plex Sans + IBM Plex Mono.
    - Product codes in mono, never truncated at right end.
    - Numbers tabular and right-aligned; counted bold, expected regular.
    - One accent: brand blue `#1849B2` (Record / primary action and active states).
    - Status colours (green `#15803D`, amber `#B45309`, red `#B91C1C`) reserved for truth and never sole carrier of meaning.
    - Touch targets ≥48px; steppers and Record button 56–64px.
    - Light theme only.
14. **Offline Queue**:
    - Tallies queue in IndexedDB when offline, bound to the user account that created them.
    - Replayed idempotently (same entry UUID) when back online.
    - Tallies arriving after finalise are rejected into quarantine, never silently dropped or injected into closed containers.
    - Photos do not queue offline (deliberate).
15. **Security Posture**:
    - RLS enabled on every table. No direct client table writes; all writes route through permission-checked SECURITY DEFINER RPCs.
    - New accounts start inactive with no permissions; login fails closed; minimum password length 12.
    - AI intake requires auth and returns 503 when key is missing — no fallback or mock data may ever return success.
    - Gemini key travels in HTTP header, never URL query params or client logs.
16. **Test & Demo Data**:
    - NEVER use real owner or company staff names in code or test fixtures. Use generic English example names (e.g. James Carter, Sarah Mitchell). Real names appear only on live physical sign-offs.
17. **Scope Boundary**:
    - App ends at finalise + Goods Received list. No put-away, bin-location, or picking modules.
    - Pallet transfers stay simple: old pallet -N, new pallet +N, no approvals.
18. **Language of Errors**:
    - When the server refuses an action, the user sees the server's real reason in plain words — never a generic "failed" message.
