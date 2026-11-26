# InwardsFlow — Product Context

Read this before any UI work. These constraints outrank aesthetics.

## Who uses it

Warehouse floor staff and a master (supervisor) at a wholesale warehouse, receiving containerised inwards goods: counting cartons onto pallets, reconciling against purchase orders, printing the Goods Received handover sheet for the supply-chain team.

## Conditions of use

- Phones first (personal Android devices, mid-range), one hand, standing at a container door. Glare, dust, intermittent attention.
- A Windows tablet is the second counting device: landscape, but browser zoom makes its effective width 720–1023px at short height — it gets the two-column tablet layout, not the phone stack.
- Desktop second (office review, catalog, users, audit).
- Speed and correctness beat beauty: a mis-tap costs a recount; a misread figure costs money.

## The three jobs

1. Count a delivery fast against its packing list / PO balance (the counting screen).
2. See what has arrived, what is short, and what needs attention (dashboard / registry).
3. Hand over a signed, accurate record (Goods Received print).

## Hard rules (never break for design)

- The counting screen's frame never scrolls: header, scan field, pallet strip and the commit dock stay fixed. Only the product list and the pad's middle section scroll internally. On small screens total + RECORD live in a pinned bottom dock — always visible. Damage & QC and Partial Box stay hidden by default.
- Touch targets ≥48px on floor screens, ≥44px elsewhere.
- No feedback sounds anywhere.
- Numbers are tabular and lining everywhere; counts never jitter.
- The Goods Received print matches the purchase-order printout format and the screen values exactly.
- Status is never carried by colour alone.
- Names shown for demo/test data are generic examples (James Carter / Sarah Mitchell) — never the owner's real name.

## Stack constraints

- Next.js + Tailwind CSS **v3** (pinned — a design pass never upgrades frameworks).
- Fonts: Poppins (UI) + IBM Plex Mono (figures/codes — Poppins has no mono cut), loaded via next/font.
- Palette: the InwardsFlow semantic colour system in `tailwind.config.ts` + `DESIGN.md`. One accent (brand blue); status colours are reserved for inventory truth.
