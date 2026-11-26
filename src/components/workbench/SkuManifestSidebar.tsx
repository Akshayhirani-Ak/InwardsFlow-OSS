'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { ExpectedItem } from '@/types/wms';
import { Search, Plus, AlertCircle, PackagePlus, EyeOff, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { rpcErrorMessage } from '@/lib/utils/errors';

interface SkuProgress {
  counted: number;
  damaged: number;
  expected: number;
  isComplete: boolean;
  pct: number;
}

interface SkuManifestSidebarProps {
  aliasMap?: Record<string, string>;
  items: ExpectedItem[];
  selectedItemId: string | null;
  onSelectItem: (item: ExpectedItem) => void;
  skuProgressMap: Record<string, SkuProgress>;
  onAddUnlistedSku: (sku: {
    sku_code: string;
    product_name: string;
    expected_cartons: number;
    pack_size: number;
  }) => Promise<void>;
  isBlindMode?: boolean;
  disabled?: boolean;
  // Small-screen counting focus (24 Nov 2026): when collapsed, the
  // sidebar renders a purpose-built slim bar (title + progress +
  // Products button) instead of the full header — the earlier design
  // clipped the full header into a short zone and its Unlisted button
  // showed through under the Products chip, reading as an overlap.
  collapsed?: boolean;
  onExpandList?: () => void;
}

const SkuLedgerRow = React.memo(
  function SkuLedgerRow({
    item,
    isSelected,
    progress,
    isBlindMode,
    onSelect,
  }: {
    item: ExpectedItem;
    isSelected: boolean;
    progress: SkuProgress;
    isBlindMode: boolean;
    onSelect: (item: ExpectedItem) => void;
  }) {
    const isOver = !isBlindMode && progress.counted > progress.expected;
    const state = isSelected ? 'Counting'
      : isBlindMode ? 'Counted'
      : isOver ? `+${(progress.counted - progress.expected).toLocaleString()} over`
      : progress.isComplete ? 'Matched' : 'Open';

    return (
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={() => onSelect(item)}
        className={`w-full min-h-12 text-left grid grid-cols-[minmax(0,1fr)_auto] content-center gap-x-2 border-l-4 px-2 py-1 hover:bg-soft ${
          isSelected ? 'border-accent bg-selection' : 'border-transparent'
        }`}
      >
        <span className="min-w-0">
          <span className="block font-mono text-sm font-semibold leading-5 text-ink [overflow-wrap:anywhere]">
            {item.sku_code}
          </span>
          <span className="block truncate text-xs leading-4 text-secondary" title={item.product_name}>
            {item.product_name} · {item.pack_size} pcs
            {Boolean(item.partial_cartons) && ` + ${item.expected_partial_qty} loose`}
          </span>
        </span>
        <span className="text-right font-mono tabular-nums">
          <span className="block text-sm font-bold leading-5 text-ink">
            {progress.counted.toLocaleString()}
            {!isBlindMode && <span className="font-normal text-muted"> / {progress.expected.toLocaleString()}</span>}
          </span>
          <span className="block text-[11px] leading-4 text-secondary">
            {state}
            {progress.damaged > 0 && ` · ${progress.damaged} damaged`}
            {item.is_priority && ' · Priority'}
            {item.is_unlisted_addition && ' · Unlisted'}
          </span>
        </span>
      </button>
    );
  },
  (prev, next) =>
    prev.isSelected === next.isSelected &&
    prev.isBlindMode === next.isBlindMode &&
    prev.item === next.item &&
    prev.progress?.counted === next.progress?.counted &&
    prev.progress?.damaged === next.progress?.damaged &&
    prev.progress?.expected === next.progress?.expected &&
    prev.progress?.isComplete === next.progress?.isComplete
);

// Code normalisation for find: case, spaces, hyphens and underscores
// are not part of a code's identity when a human types it from a carton.
const normCode = (s: string) => s.toUpperCase().replace(/[\s\-_]/g, '');

export const SkuManifestSidebar: React.FC<SkuManifestSidebarProps> = ({
  aliasMap = {},
  items,
  selectedItemId,
  onSelectItem,
  skuProgressMap,
  onAddUnlistedSku,
  isBlindMode = false,
  disabled = false,
  collapsed = false,
  onExpandList,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  // Find-speed (2026-11-23): the working list defaults to Open so it
  // shrinks as products complete — finished lines live under Matched,
  // one tap away, never clogging the hunt. Blind mode keeps All (its
  // progress is hidden by design, so filtering on it would confuse).
  const [filterMode, setFilterMode] = useState<'all' | 'open' | 'matched'>(
    isBlindMode ? 'all' : 'open'
  );
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // New unlisted SKU form state
  const [newSkuCode, setNewSkuCode] = useState('');
  const [newProductName, setNewProductName] = useState('');
  const [newCartons, setNewCartons] = useState('1');
  const [newPackSize, setNewPackSize] = useState('1');
  const [errorMsg, setErrorMsg] = useState('');

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Phase 11: supplier-code aliases (supplier code -> our SKU). Loaded once
  // so a scanned barcode also finds products that were first catalogued
  // under a supplier's internal code (and vice versa).

  // Keyboard shortcut: '/' focuses search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchInputRef.current && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Find-speed (2026-11-23): code-first ranked search. The query and the
  // codes are normalised (case, spaces, hyphens stripped) so "ad 1256",
  // "AD-1256" and "DEMO125" are the same search. Tiers: 0 = exact code /
  // supplier code / alias hit, 1 = code prefix, 2 = code contains,
  // 3 = name with every typed word present (any order). Within a tier —
  // and for the un-searched list — order is: open before completed,
  // priority first, then MANIFEST (packing-slip) order, never reshuffled
  // A–Z: the physical pile follows the slip, so the list does too.
  const matchTier = useCallback((item: ExpectedItem, rawTerm: string, normTerm: string): number => {
    if (!normTerm) return 0;
    const sku = normCode(item.sku_code);
    const supplier = normCode(item.supplier_sku_code || '');
    const aliasTarget =
      aliasMap[rawTerm.toUpperCase()] ?? aliasMap[normTerm];
    if (aliasTarget !== undefined && aliasTarget === item.sku_code.toUpperCase()) return 0;
    if (sku === normTerm || (supplier !== '' && supplier === normTerm)) return 0;
    if (sku.startsWith(normTerm) || (supplier !== '' && supplier.startsWith(normTerm))) return 1;
    if (sku.includes(normTerm) || (supplier !== '' && supplier.includes(normTerm))) return 2;
    const name = item.product_name.toLowerCase();
    const words = rawTerm.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length > 0 && words.every((w) => name.includes(w))) return 3;
    return -1;
  }, [aliasMap]);

  const filteredItems = useMemo(() => {
    const rawTerm = searchTerm.trim();
    const normTerm = normCode(rawTerm);
    const slipIndex = new Map(items.map((item, i) => [item.id, i]));

    const list = items.filter((item) => {
      if (matchTier(item, rawTerm, normTerm) < 0) return false;

      const progress = skuProgressMap[item.id] || {
        counted: 0,
        damaged: 0,
        expected: item.expected_total_qty,
        isComplete: false,
        pct: 0,
      };

      if (filterMode === 'open') {
        return !progress.isComplete;
      }
      if (filterMode === 'matched') {
        return progress.isComplete;
      }
      return true;
    });

    return list.sort((a, b) => {
      if (normTerm) {
        const tierDiff = matchTier(a, rawTerm, normTerm) - matchTier(b, rawTerm, normTerm);
        if (tierDiff !== 0) return tierDiff;
      }
      const aComp = skuProgressMap[a.id]?.isComplete ? 1 : 0;
      const bComp = skuProgressMap[b.id]?.isComplete ? 1 : 0;
      if (aComp !== bComp) return aComp - bComp;

      const aPrio = a.is_priority ? 1 : 0;
      const bPrio = b.is_priority ? 1 : 0;
      if (aPrio !== bPrio) return bPrio - aPrio;

      return (slipIndex.get(a.id) ?? 0) - (slipIndex.get(b.id) ?? 0);
    });
  }, [items, searchTerm, filterMode, skuProgressMap, matchTier]);

  // Enter (or a scanner's Enter) selects the match ONLY when exactly one
  // product matches the typed code exactly — near-twins (DEMO125 vs
  // DEMO125BULK) are listed for a tap, never auto-chosen. This is also the
  // scan-to-find path: a HID scanner types the barcode here + Enter.
  const handleSearchEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const rawTerm = searchTerm.trim();
    if (!rawTerm) return;
    const normTerm = normCode(rawTerm);
    const exact = items.filter((item) => matchTier(item, rawTerm, normTerm) === 0);
    if (exact.length === 1) {
      e.preventDefault();
      onSelectItem(exact[0]);
      setSearchTerm('');
      searchInputRef.current?.blur();
    }
  };

  const handleOpenAddModal = () => {
    setErrorMsg('');
    setNewSkuCode('');
    setNewProductName('');
    setNewCartons('1');
    setNewPackSize('1');
    setIsAddModalOpen(true);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSkuCode.trim() || !newProductName.trim()) {
      setErrorMsg('Product code and product name are required.');
      return;
    }
    const cartons = parseInt(newCartons, 10);
    const pack = parseInt(newPackSize, 10);
    if (isNaN(cartons) || cartons <= 0 || isNaN(pack) || pack <= 0) {
      setErrorMsg('Expected cartons and pack size must be positive numbers.');
      return;
    }

    try {
      setIsSubmitting(true);
      await onAddUnlistedSku({
        sku_code: newSkuCode.trim().toUpperCase(),
        product_name: newProductName.trim(),
        expected_cartons: cartons,
        pack_size: pack,
      });
      setIsAddModalOpen(false);
    } catch (err: unknown) {
      setErrorMsg(rpcErrorMessage(err, 'Failed to add unlisted product'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalCount = items.length;
  const completedCount = items.filter(
    (item) => skuProgressMap[item.id]?.isComplete
  ).length;

  return (
    <>
      {collapsed && (
        <button
          type="button"
          onClick={onExpandList}
          aria-label="Show the product list"
          className="hidden max-[719px]:flex h-[3.375rem] w-full shrink-0 items-center justify-between gap-3 bg-white px-4 text-left"
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="whitespace-nowrap text-sm font-bold text-ink">
              Container Manifest
            </span>
            <span className="truncate font-mono text-[11px] tabular-nums text-secondary">
              {isBlindMode
                ? `${totalCount} products`
                : `${completedCount}/${totalCount} · ${totalCount - completedCount} left`}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 rounded-control border border-edge px-2.5 py-1.5 text-xs font-bold text-accent">
            Products
            <ChevronDown className="h-4 w-4" strokeWidth={2} />
          </span>
        </button>
      )}
    <aside className={`w-full flex flex-col bg-white flex-shrink-0 ${collapsed ? 'max-[719px]:hidden' : ''}`}>
      {/* List Header — Phase 34: slim and sticky, so the list zone shows
          product rows, not chrome. Title + count share one line; search
          and the filter tabs share the second. Sticky within the list
          zone: the controls stay while the rows scroll under them. */}
      <div className="manifest-header px-2 border-b border-line bg-white sticky top-0 z-20">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2 min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-semibold text-ink whitespace-nowrap">
                Manifest
              </h2>
              {isBlindMode && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-mono font-bold text-warning px-1 py-0.2">
                  <EyeOff className="w-3 h-3 text-warning" strokeWidth={1.75} />
                  BLIND
                </span>
              )}
            </div>
            <span className="min-w-0 truncate font-mono text-[11px] tabular-nums text-secondary">
              {isBlindMode
                ? `${totalCount} products`
                : `${completedCount}/${totalCount}`}
            </span>
          </div>
          <Button
            size="md"
            variant="outline"
            onClick={handleOpenAddModal}
            disabled={disabled}
            className="px-2 text-xs whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5 mr-1 text-accent" strokeWidth={1.75} />
            Unlisted Product
          </Button>
        </div>

        <div className="manifest-filters flex flex-col gap-2 pb-1">
          {/* Search Input — full width on phones (24 Nov 2026): sharing
              a row with the tabs truncated its placeholder and cramped
              both. Tabs get their own spread row underneath. */}
          <div className="relative min-w-0 flex-1">
          <Search className="manifest-search-icon w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" strokeWidth={1.75} />
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleSearchEnter}
            aria-label="Search code or name"
            placeholder="Search"
            enterKeyHint="search"
            autoComplete="off"
            className="manifest-search w-full pl-9 pr-3 py-2 text-sm bg-white border border-edge rounded-control focus:outline-none focus:ring-1 focus:ring-accent font-mono"
          />
        </div>

          {!isBlindMode && (
            <div className="flex justify-between gap-1 text-xs shrink-0">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              aria-pressed={filterMode === 'all'}
              className={`min-h-12 px-1 tabular-nums ${
                filterMode === 'all'
                  ? 'rounded-full bg-selection text-accent font-semibold'
                  : 'text-secondary hover:text-ink'
              }`}
            >
              All ({items.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('open')}
              aria-pressed={filterMode === 'open'}
              className={`min-h-12 px-1 tabular-nums ${
                filterMode === 'open'
                  ? 'rounded-full bg-selection text-accent font-semibold'
                  : 'text-secondary hover:text-ink'
              }`}
            >
              Open ({items.length - completedCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('matched')}
              aria-pressed={filterMode === 'matched'}
              className={`min-h-12 px-1 tabular-nums ${
                filterMode === 'matched'
                  ? 'rounded-full bg-selection text-accent font-semibold'
                  : 'text-secondary hover:text-ink'
              }`}
            >
              Matched ({completedCount})
            </button>
            </div>
          )}
        </div>
      </div>

      <div>
        {filteredItems.length === 0 ? (
          <div className="p-8 text-center text-muted">
            <PackagePlus className="w-8 h-8 mx-auto mb-2 text-line" strokeWidth={1.75} />
            <p className="text-xs font-medium">No matching SKUs found</p>
          </div>
        ) : (
            <div className="divide-y divide-line">
              {filteredItems.map((item) => (
                <SkuLedgerRow
                  key={item.id}
                  item={item}
                  isSelected={item.id === selectedItemId}
                  progress={
                    skuProgressMap[item.id] || {
                      counted: 0,
                      damaged: 0,
                      expected: item.expected_total_qty,
                      isComplete: false,
                      pct: 0,
                    }
                  }
                  isBlindMode={isBlindMode}
                  onSelect={onSelectItem}
                />
              ))}
            </div>
        )}
      </div>

      {/* Add Unlisted SKU Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Register Unlisted Container SKU"
      >
        <form onSubmit={handleAddSubmit} className="space-y-4">
          <p className="text-xs text-secondary">
            Discovered stock physically inside the container not listed on the original packing manifest.
            Registering will stage the item in the active container.
          </p>

          {errorMsg && (
            <div className="p-3 bg-damage border border-damage text-danger rounded text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
              <span>{errorMsg}</span>
            </div>
          )}

          <Input
            label="SKU Code"
            value={newSkuCode}
            onChange={(e) => setNewSkuCode(e.target.value.toUpperCase())}
            placeholder="e.g. SKU-UNL-9901"
            required
            className="font-mono uppercase"
          />

          <Input
            label="Product Name / Description"
            value={newProductName}
            onChange={(e) => setNewProductName(e.target.value)}
            placeholder="e.g. Unlisted Hardware Accessory"
            required
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Expected Cartons"
              type="number"
              min="1"
              value={newCartons}
              onChange={(e) => setNewCartons(e.target.value)}
              required
            />
            <Input
              label="Pack Size (Pcs / Box)"
              type="number"
              min="1"
              value={newPackSize}
              onChange={(e) => setNewPackSize(e.target.value)}
              required
            />
          </div>

          <div className="p-2.5 bg-soft border border-edge rounded text-xs font-mono text-secondary flex justify-between">
            <span>Calculated Expected Total:</span>
            <strong className="text-ink tabular-nums">
              {((parseInt(newCartons, 10) || 0) * (parseInt(newPackSize, 10) || 0)).toLocaleString()} Units
            </strong>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsAddModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? 'Registering...' : 'Add to Manifest'}
            </Button>
          </div>
        </form>
      </Modal>
    </aside>
    </>
  );
};
