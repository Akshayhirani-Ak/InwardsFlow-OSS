'use client';

export const dynamic = 'force-dynamic';

// Phase 38 — Organise Pallets: a separate screen for the after-counting
// job — merging split products onto one pallet and moving stock between
// pallets. Research pattern (CartonCloud / Bitergo repacking): enter
// from the product (split fixer) or from the pallet (merge whole pallet
// / move a product), review before confirming, and a merge MOVES stock —
// it never copies it — so the container totals in the header are
// identical before and after every action. All moves run through the
// Phase 21 transfer_cartons RPC (FIFO, whole entries re-point in place).
// Phase 38c: built as ONE pad surface in the counting pad's own pattern
// (38b only re-skinned the list, which still read as a different app):
// mono codes and figures, hairline rows, target chips instead of native
// selects, and the pad's RECORD-bar rule — one big primary button whose
// label states exactly what it commits ("BRING 15 BOXES · 150 UNITS
// ONTO PLT-003"), so reading the button IS the confirmation.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Container, ExpectedItem, Pallet, PalletEntry } from '@/types/wms';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { moveGoodBoxes } from '@/lib/workbench/transfer';
import { Button } from '@/components/ui/Button';
import {
  containerTotals,
  palletSummaries,
  splitProducts,
  type PalletSummary,
  type PileEntry,
  type ProductPiles,
} from '@/lib/workbench/organise';
import {
  ArrowLeft,
  RefreshCw,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Merge,
  MoveRight,
  Minus,
  Plus,
} from 'lucide-react';

/** One figure in a stat row — the pallet bar's stat-block language. */
const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex flex-col justify-center">
    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted leading-tight">
      {label}
    </span>
    <span className="text-base font-bold tabular-nums text-ink leading-tight">
      {value}
    </span>
  </div>
);

export default function OrganisePalletsPage() {
  const params = useParams();
  const containerId = params?.containerId as string;
  const supabase = createBrowserSupabaseClient();

  const [container, setContainer] = useState<Container | null>(null);
  const [items, setItems] = useState<ExpectedItem[]>([]);
  const [pallets, setPallets] = useState<Pallet[]>([]);
  const [entries, setEntries] = useState<PalletEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');

  // Per-card UI state.
  const [splitTargets, setSplitTargets] = useState<Record<string, string>>({});
  const [mergePick, setMergePick] = useState<Record<string, string>>({});
  const [moveOpen, setMoveOpen] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<Record<string, string>>({});
  const [moveBoxes, setMoveBoxes] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    if (!containerId) return;
    try {
      setLoadError('');
      const { data: wb, error } = await supabase.rpc('get_container_workbench', {
        p_container_id: containerId,
      });
      if (error) throw error;
      const workbench = wb as unknown as {
        container: Container | null;
        items: ExpectedItem[];
        pallets: Pallet[];
        entries: PalletEntry[];
      } | null;
      if (!workbench?.container) {
        setLoadError('Container not found or access restricted.');
        return;
      }
      setContainer(workbench.container);
      setItems(workbench.items || []);
      setPallets(workbench.pallets || []);
      setEntries(workbench.entries || []);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Failed to load this container.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [containerId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const splits = useMemo(
    () => splitProducts(entries, items, pallets),
    [entries, items, pallets]
  );
  const summaries = useMemo(
    () => palletSummaries(entries, items, pallets),
    [entries, items, pallets]
  );
  const totals = useMemo(() => containerTotals(entries), [entries]);
  const isCompleted = container?.status === 'completed';
  const openPallets = useMemo(
    () => pallets.filter((p) => p.status === 'open'),
    [pallets]
  );
  const palletCode = useCallback(
    (id: string) => pallets.find((p) => p.id === id)?.pallet_code || 'PLT-???',
    [pallets]
  );

  const moveEntries = (entries: PileEntry[], boxes: number, target: string) =>
    moveGoodBoxes(entries, boxes, target, (args) => supabase.rpc('transfer_cartons', args));

  const runAction = useCallback(
    async (key: string, fn: () => Promise<string>) => {
      setBusy(key);
      setNotice('');
      setActionError('');
      try {
        const message = await fn();
        await load();
        setNotice(message);
      } catch (err) {
        await load();
        setActionError(
          err instanceof Error ? err.message : 'That move did not complete.'
        );
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const bringTogether = (product: ProductPiles) => {
    const targetId =
      splitTargets[product.itemId] || product.suggestedTargetPalletId;
    void runAction(`split-${product.itemId}`, async () => {
      let movedBoxes = 0;
      let movedUnits = 0;
      let leftover = 0;
      for (const pile of product.piles) {
        if (pile.palletId === targetId) continue;
        const r = await moveEntries(pile.entries, pile.boxes, targetId);
        movedBoxes += r.movedBoxes;
        movedUnits += r.movedUnits;
        leftover += r.leftoverBoxes;
      }
      const base = `Moved ${movedBoxes} boxes (${movedUnits} units) onto ${palletCode(targetId)} — ${product.skuCode} now sits on one pallet.`;
      return leftover > 0
        ? `${base} ${leftover} boxes stayed behind — damaged or loose pieces can't travel; they stay where they were counted.`
        : base;
    });
  };

  const mergePalletInto = (summary: PalletSummary, target: string) => {
    void runAction(`merge-${summary.palletId}`, async () => {
      let movedBoxes = 0;
      let movedUnits = 0;
      let leftover = 0;
      let code: string | null = target === 'NEW' ? null : palletCode(target);
      // After the first move into a NEW pallet, keep targeting the pallet
      // it created (its id comes back from the RPC) — never a second one.
      let dest = target;
      for (const row of summary.products) {
        const r = await moveEntries(row.entries, row.boxes, dest);
        movedBoxes += r.movedBoxes;
        movedUnits += r.movedUnits;
        leftover += r.leftoverBoxes;
        code = r.targetCode || code;
        if (dest === 'NEW' && r.targetId) dest = r.targetId;
      }
      const base = `${summary.palletCode} merged into ${code || 'the new pallet'} — ${movedBoxes} boxes (${movedUnits} units) moved.`;
      return leftover > 0
        ? `${base} ${leftover} boxes stayed on ${summary.palletCode} — damaged or loose pieces can't travel.`
        : base;
    });
  };

  const moveProduct = (
    summary: PalletSummary,
    row: PalletSummary['products'][number]
  ) => {
    const key = `${summary.palletId}:${row.itemId}`;
    const target = moveTarget[key];
    const boxes = Math.min(moveBoxes[key] ?? row.boxes, row.boxes);
    if (!target) return;
    void runAction(`move-${key}`, async () => {
      const r = await moveEntries(row.entries, boxes, target);
      setMoveOpen(null);
      const base = `Moved ${r.movedBoxes} boxes of ${row.skuCode} (${r.movedUnits} units) from ${summary.palletCode} to ${r.targetCode || palletCode(target)}.`;
      return r.leftoverBoxes > 0
        ? `${base} ${r.leftoverBoxes} boxes stayed — damaged or loose pieces can't travel.`
        : base;
    });
  };

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 text-center text-sm text-secondary">
        Loading pallets…
      </div>
    );
  }
  if (loadError || !container) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <p className="text-sm font-semibold text-danger">
          {loadError || 'Container not found.'}
        </p>
        <Link
          href="/dashboard"
          className="inline-block mt-4 text-sm font-semibold text-accent"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  const chipBtn =
    'px-3.5 py-2 min-h-[48px] rounded-control text-sm font-semibold bg-white text-ink border border-edge hover:bg-soft disabled:opacity-40 inline-flex items-center justify-center gap-1.5 tabular-nums';
  const chipBtnActive =
    'px-3.5 py-2 min-h-[48px] rounded-control text-sm font-semibold bg-selection text-accent border border-accent disabled:opacity-40 inline-flex items-center justify-center gap-1.5 tabular-nums';
  const sectionLabel =
    'text-xs font-bold uppercase tracking-wider text-muted';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 space-y-4 pb-16">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/workbench/${containerId}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent min-h-[48px]"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={1.75} />
          Back to counting
        </Link>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-secondary min-h-[48px] px-2"
        >
          <RefreshCw className="w-4 h-4" strokeWidth={1.75} />
          Refresh
        </button>
      </div>

      {notice && (
        <div className="border border-received bg-received rounded-control px-4 py-3 text-sm font-medium text-positive flex gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={1.75} />
          {notice}
        </div>
      )}
      {actionError && (
        <div className="border border-damage bg-damage rounded-control px-4 py-3 text-sm font-medium text-danger flex gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={1.75} />
          {actionError}
        </div>
      )}

      {/* ONE pad surface — header, split fixer and pallets as sections of
          a single panel, the way the counting pad is one surface. */}
      <div className="bg-surface border border-line rounded-card">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4">
          <h1 className="text-lg font-bold text-ink">
            Organise pallets
          </h1>
          <p className="text-sm text-secondary mt-0.5 font-mono">
            {container.container_number}
            <span className="font-sans text-muted">
              {' '}
              · Merge and tidy pallets after counting.
            </span>
          </p>
          <div className="flex items-center gap-5 mt-3 pt-3 border-t border-line">
            <Stat label="Boxes" value={String(totals.boxes)} />
            <div className="w-px h-8 bg-line" />
            <Stat label="Units" value={String(totals.units)} />
            <div className="w-px h-8 bg-line" />
            <Stat
              label="Pallets with stock"
              value={String(summaries.filter((s) => !s.isEmpty).length)}
            />
          </div>
          <p className="text-xs text-muted mt-2">
            Organising only moves stock — these totals stay exactly the same.
          </p>
          {isCompleted && (
            <p className="text-sm font-medium text-secondary flex items-center gap-1.5 mt-3">
              <Lock className="w-4 h-4 shrink-0" strokeWidth={1.75} />
              This load is finalised, so its pallets can&apos;t change.
              Reopen it from the dashboard if you need to reorganise.
            </p>
          )}
        </div>

        {/* Split products — the one-tap fixer */}
        {!isCompleted && splits.length > 0 && (
          <section className="border-t border-line px-4 sm:px-6 py-4">
            <h2 className={sectionLabel}>Split products — bring together</h2>
            {splits.map((product) => {
              const targetId =
                splitTargets[product.itemId] ||
                product.suggestedTargetPalletId;
              const sealedInvolved = product.piles.some(
                (p) => p.palletStatus !== 'open'
              );
              const targetPile = product.piles.find(
                (p) => p.palletId === targetId
              );
              const movingBoxes = product.totalBoxes - (targetPile?.boxes || 0);
              const movingUnits = product.totalUnits - (targetPile?.units || 0);
              const targetOptions = [
                ...product.piles
                  .filter((p) => p.palletStatus === 'open')
                  .map((pile) => ({
                    id: pile.palletId,
                    code: pile.palletCode,
                    note:
                      pile.palletId === product.suggestedTargetPalletId
                        ? 'biggest'
                        : `${pile.units} units`,
                  })),
                ...openPallets
                  .filter(
                    (p) => !product.piles.some((x) => x.palletId === p.id)
                  )
                  .map((p) => ({
                    id: p.id,
                    code: p.pallet_code,
                    note: 'other pallet',
                  })),
              ];
              return (
                <div
                  key={product.itemId}
                  className="py-4 border-b border-line last:border-0 last:pb-0 first:pt-3 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono font-bold text-base text-ink">
                        {product.skuCode}
                      </p>
                      <p className="text-sm text-secondary truncate">
                        {product.productName}
                      </p>
                    </div>
                    <p className="font-mono tabular-nums text-sm text-ink text-right shrink-0">
                      {product.totalUnits.toLocaleString()} units
                      <span className="block text-xs text-muted font-sans">
                        on {product.piles.length} pallets
                      </span>
                    </p>
                  </div>

                  {/* Piles — LocationRowView's mono rows */}
                  <div>
                    {product.piles.map((pile) => (
                      <div
                        key={pile.palletId}
                        className="flex items-center justify-between gap-2 py-1.5"
                      >
                        <span className="font-mono font-bold text-[13px] text-ink">
                          {pile.palletCode}
                          {pile.palletId ===
                            product.suggestedTargetPalletId && (
                            <span className="ml-2 text-[11px] font-bold text-accent">
                              BIGGEST
                            </span>
                          )}
                          {pile.palletId === targetId && (
                            <span className="ml-2 text-[11px] font-bold text-positive">
                              KEEP HERE
                            </span>
                          )}
                        </span>
                        <span className="font-mono tabular-nums text-sm text-ink">
                          {pile.boxes} boxes · {pile.units.toLocaleString()}{' '}
                          units
                        </span>
                      </div>
                    ))}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-secondary mb-1">
                      Bring everything onto
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {targetOptions.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            setSplitTargets((prev) => ({
                              ...prev,
                              [product.itemId]: opt.id,
                            }))
                          }
                          disabled={busy !== null}
                          className={
                            targetId === opt.id ? chipBtnActive : chipBtn
                          }
                        >
                          {opt.code}
                          <span className="text-xs font-medium opacity-75">
                            {opt.note}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {sealedInvolved ? (
                    <p className="text-xs font-medium text-warning flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" strokeWidth={1.75} />
                      One of these pallets is sealed — unseal it on the
                      counting screen to move its stock.
                    </p>
                  ) : (
                    <Button
                      type="button"
                      variant="primary"
                      size="lg"
                      onClick={() => bringTogether(product)}
                      disabled={busy !== null}
                      className="font-bold min-h-[56px] text-[15px] w-full tabular-nums"
                    >
                      <Merge className="w-4 h-4 mr-2" strokeWidth={1.75} />
                      {busy === `split-${product.itemId}`
                        ? 'MOVING…'
                        : `BRING ${movingBoxes} BOXES · ${movingUnits.toLocaleString()} UNITS ONTO ${palletCode(targetId)}`}
                    </Button>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {/* Pallets */}
        <section className="border-t border-line px-4 sm:px-6 py-4">
          <h2 className={sectionLabel}>Pallets</h2>
          {summaries.map((summary) => {
            const sealed = summary.palletStatus !== 'open';
            const mergeTargets = openPallets.filter(
              (p) => p.id !== summary.palletId
            );
            const chosenMerge = mergePick[summary.palletId] || '';
            return (
              <div
                key={summary.palletId}
                className="py-4 border-b border-line last:border-0 last:pb-0 first:pt-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono font-bold text-base text-ink">
                    {summary.palletCode}
                    {sealed && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-sans font-semibold text-warning align-middle">
                        <Lock className="w-3.5 h-3.5" strokeWidth={1.75} />
                        Sealed
                      </span>
                    )}
                  </p>
                  {summary.isEmpty ? (
                    <span className="text-sm font-medium text-muted">
                      Empty
                    </span>
                  ) : (
                    <span className="font-mono tabular-nums text-sm text-ink">
                      {summary.boxes} boxes · {summary.units.toLocaleString()}{' '}
                      units
                      <span className="block text-right text-xs text-muted font-sans">
                        {summary.products.length} products
                      </span>
                    </span>
                  )}
                </div>

                {!summary.isEmpty &&
                  summary.products.map((row) => {
                    const key = `${summary.palletId}:${row.itemId}`;
                    const boxesChosen = Math.min(
                      moveBoxes[key] ?? row.boxes,
                      row.boxes
                    );
                    const dest = moveTarget[key] || '';
                    return (
                      <div
                        key={key}
                        className="py-2.5 border-b border-line last:border-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-bold text-[13px] text-ink">
                            {row.skuCode}
                          </span>
                          <span className="font-mono tabular-nums text-sm text-ink">
                            {row.boxes} boxes · {row.units.toLocaleString()}{' '}
                            units
                          </span>
                        </div>
                        <p className="text-sm text-secondary truncate">
                          {row.productName}
                          {row.damagedUnits > 0 && (
                            <span className="text-danger font-medium">
                              {' '}
                              · {row.damagedUnits} damaged
                            </span>
                          )}
                        </p>

                        {!isCompleted && !sealed && moveOpen !== key && (
                          <button
                            type="button"
                            onClick={() => {
                              setMoveOpen(key);
                              setMoveBoxes((prev) => ({
                                ...prev,
                                [key]: row.boxes,
                              }));
                            }}
                            disabled={busy !== null}
                            className={`${chipBtn} mt-2`}
                          >
                            <MoveRight
                              className="w-4 h-4"
                              strokeWidth={1.75}
                            />
                            Move
                          </button>
                        )}

                        {!isCompleted && !sealed && moveOpen === key && (
                          <div className="mt-2.5 space-y-3">
                            {/* StepperInput's exact shape from the tally pad */}
                            <div>
                              <label className="block text-xs font-semibold text-secondary mb-1">
                                Boxes to move (of {row.boxes})
                              </label>
                              <div className="flex items-stretch gap-1.5">
                                <button
                                  type="button"
                                  aria-label="One box fewer"
                                  onClick={() =>
                                    setMoveBoxes((prev) => ({
                                      ...prev,
                                      [key]: Math.max(1, boxesChosen - 1),
                                    }))
                                  }
                                  className="w-12 min-h-[48px] flex items-center justify-center bg-white border border-edge text-ink hover:bg-soft rounded-l-control disabled:opacity-40"
                                >
                                  <Minus className="w-4 h-4" strokeWidth={2} />
                                </button>
                                <div className="flex-1 min-w-0 px-2 py-1.5 min-h-[48px] font-mono tabular-nums text-base font-bold text-center bg-white border border-edge flex items-center justify-center">
                                  {boxesChosen}
                                </div>
                                <button
                                  type="button"
                                  aria-label="One box more"
                                  onClick={() =>
                                    setMoveBoxes((prev) => ({
                                      ...prev,
                                      [key]: Math.min(row.boxes, boxesChosen + 1),
                                    }))
                                  }
                                  className="w-12 min-h-[48px] flex items-center justify-center bg-white border border-edge text-ink hover:bg-soft rounded-r-control disabled:opacity-40"
                                >
                                  <Plus className="w-4 h-4" strokeWidth={2} />
                                </button>
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-secondary mb-1">
                                Move to
                              </label>
                              <div className="flex flex-wrap gap-1.5">
                                {mergeTargets.map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() =>
                                      setMoveTarget((prev) => ({
                                        ...prev,
                                        [key]: p.id,
                                      }))
                                    }
                                    className={
                                      dest === p.id ? chipBtnActive : chipBtn
                                    }
                                  >
                                    → {p.pallet_code}
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setMoveTarget((prev) => ({
                                      ...prev,
                                      [key]: 'NEW',
                                    }))
                                  }
                                  className={
                                    dest === 'NEW' ? chipBtnActive : chipBtn
                                  }
                                >
                                  → New pallet
                                </button>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="primary"
                                size="lg"
                                onClick={() => moveProduct(summary, row)}
                                disabled={busy !== null || !dest}
                                className="font-bold min-h-[56px] text-[15px] flex-1 tabular-nums"
                              >
                                {busy === `move-${key}`
                                  ? 'MOVING…'
                                  : `MOVE ${boxesChosen} BOXES → ${
                                      dest === 'NEW'
                                        ? 'NEW PALLET'
                                        : dest
                                          ? palletCode(dest)
                                          : '…'
                                    }`}
                              </Button>
                              <button
                                type="button"
                                onClick={() => setMoveOpen(null)}
                                disabled={busy !== null}
                                className="min-h-[56px] px-5 rounded-control border border-edge bg-white text-sm font-semibold text-secondary disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                {/* Merge whole pallet — chips, then the commit button
                    states the whole move, RECORD-bar style. */}
                {!isCompleted && !sealed && !summary.isEmpty && (
                  <div className="mt-3 space-y-2.5">
                    <label className="block text-xs font-semibold text-secondary">
                      Merge this pallet into
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {mergeTargets.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() =>
                            setMergePick((prev) => ({
                              ...prev,
                              [summary.palletId]: p.id,
                            }))
                          }
                          disabled={busy !== null}
                          className={
                            chosenMerge === p.id ? chipBtnActive : chipBtn
                          }
                        >
                          → {p.pallet_code}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setMergePick((prev) => ({
                            ...prev,
                            [summary.palletId]: 'NEW',
                          }))
                        }
                        disabled={busy !== null}
                        className={
                          chosenMerge === 'NEW' ? chipBtnActive : chipBtn
                        }
                      >
                        → New pallet
                      </button>
                    </div>
                    <Button
                      type="button"
                      variant="primary"
                      size="lg"
                      onClick={() => mergePalletInto(summary, chosenMerge)}
                      disabled={busy !== null || !chosenMerge}
                      className="font-bold min-h-[56px] text-[15px] w-full tabular-nums"
                    >
                      <Merge className="w-4 h-4 mr-2" strokeWidth={1.75} />
                      {busy === `merge-${summary.palletId}`
                        ? 'MERGING…'
                        : !chosenMerge
                          ? `MERGE ${summary.palletCode} — PICK A TARGET ABOVE`
                          : `MERGE ${summary.palletCode} · ${summary.boxes} BOXES · ${summary.units.toLocaleString()} UNITS → ${
                              chosenMerge === 'NEW'
                                ? 'NEW PALLET'
                                : palletCode(chosenMerge)
                            }`}
                    </Button>
                  </div>
                )}
                {sealed && !summary.isEmpty && (
                  <p className="text-xs font-medium text-warning mt-3">
                    Sealed pallets are locked — unseal on the counting screen
                    to move this stock.
                  </p>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
