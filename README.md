# InwardsFlow

An open-source inbound warehouse receiving app: container counting,
de-vanning, palletisation and quality control (QC) for goods-inwards teams.

InwardsFlow mirrors how receiving actually works on the warehouse floor.
A delivery is counted against the supplier's packing list first — never
against the purchase order. Counted quantities are then matched to open
purchase orders (oldest first), damaged units are recorded separately and
never counted as received, and finalising a delivery produces a signed
Goods Received handover sheet listing only what physically arrived.

## Features

- **One-screen counting pad** — scan or tap to count boxes onto pallets,
  with quick-multiply keys, a fixed (non-scrolling) counting screen, and
  support for full boxes, partial boxes and per-piece counts.
- **Barcode scanning** — GS1-128 parsing (AI 02/01 GTINs, GTIN-14 → EAN-13
  conversion), supplier-code alias resolution, and wrong-code warnings
  that name the product actually scanned.
- **AI document intake** — drop a packing list, invoice or purchase order
  (PDF or photo) and have the lines extracted and staged for review before
  anything is filed.
- **Purchase-order matching** — cumulative PO balances (ordered /
  received-to-date / still owed), partial deliveries, short-close with a
  mandatory reason, and counted-beyond-PO reporting.
- **Damage & QC capture** — damaged units recorded with reasons, kept out
  of received totals, and shown on the record.
- **Offline queue** — tallies captured offline are stored locally and
  replayed idempotently when the connection returns.
- **Goods Received print** — a clean, signed handover sheet (received-by /
  checked-by) generated from the finalised counts.
- **Catalogue learning** — pack sizes and product aliases are learned from
  finalised receipts, with verification kept as an explicit human action.
- **Roles & permissions** — operator / supervisor ("master") access levels
  with an auditable trail of changes.

## Tech stack

- [Next.js](https://nextjs.org) 14 (App Router) + TypeScript + Tailwind CSS
- [Supabase](https://supabase.com) — Postgres, Auth, Row Level Security and
  RPC-based writes
- Google Gemini for document extraction at intake (server-side only)
- Vitest for unit/component tests, Playwright for smoke tests

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your own values
npm run dev
```

### Environment variables

See `.env.example` for the full list. At minimum you need your own Supabase
project URL and publishable (anon) key:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `GEMINI_API_KEY` (server-only, for AI document intake)

No variable has a code fallback: if one is missing, the app fails loudly
rather than silently using someone else's project.

### Database schema

**The database schema is not included in this repository.** The app expects
a Supabase (Postgres) database with the tables, Row Level Security policies
and RPC functions the code calls; you will need to create a schema that
satisfies those calls to run it end-to-end. The application code is provided
as-is for study, adaptation and contribution.

## Tests

```bash
npm test            # Vitest unit/component tests
npm run build       # production build (needs the NEXT_PUBLIC_ vars set)
npm run test:e2e    # Playwright smoke tests
```

## License

[MIT](LICENSE)
