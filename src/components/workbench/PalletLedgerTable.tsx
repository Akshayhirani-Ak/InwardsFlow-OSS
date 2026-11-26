'use client';

import React, { useState } from 'react';
import { PalletEntry, ExpectedItem, Pallet } from '@/types/wms';
import {
  Ban,
  Clock,
  ListFilter,
  AlertTriangle,
  User,
  ArrowRightLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { cleanDisplay } from '@/lib/utils/auth-mapper';
import { rpcErrorMessage } from '@/lib/utils/errors';

interface PalletLedgerTableProps {
  entries: PalletEntry[];
  itemsMap: Record<string, ExpectedItem>;
  palletsMap: Record<string, Pallet>;
  palletsList?: Pallet[];
  selectedItemId: string | null;
  canVoid: boolean;
  photoUrlsByEntryId?: Record<string, string[]>;
  onVoidEntry: (entryId: string, reason: string) => Promise<void>;
  onMovePallet?: (entryId: string, newPalletId: string) => Promise<void>;
  disabled?: boolean;
}

const PalletLedgerTableRow = React.memo(
  function PalletLedgerTableRow({
    entry,
    item,
    pallet,
    photos,
    canVoid,
    canMove,
    disabled,
    onOpenVoid,
    onOpenMove,
  }: {
    entry: PalletEntry;
    item: ExpectedItem | undefined;
    pallet: Pallet | undefined;
    photos: string[] | undefined;
    canVoid: boolean;
    canMove: boolean;
    disabled: boolean;
    onOpenVoid: (entryId: string) => void;
    onOpenMove: (entry: PalletEntry) => void;
  }) {
    const isVoided = entry.is_voided;
    const formattedTime = new Date(entry.created_at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    return (
      <tr
        className={`hover:bg-soft transition-colors ${
          isVoided ? 'bg-soft/50 opacity-60 line-through' : ''
        }`}
      >
        <td className="py-2.5 px-4 font-mono tabular-nums text-muted whitespace-nowrap">
          {formattedTime}
        </td>

        <td className="py-2.5 px-4 whitespace-nowrap">
          <span className="font-mono font-bold text-ink">
            {pallet?.pallet_code || 'PLT-???'}
          </span>
        </td>

        <td className="py-2.5 px-4">
          <div className="font-mono font-bold text-ink">
            {item?.sku_code || 'UNKNOWN'}
          </div>
          <div className="text-[11px] text-muted truncate max-w-xs font-medium">
            {item?.product_name || 'Item info unavailable'}
          </div>
        </td>

        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-secondary">
          {entry.cartons_counted} boxes × {entry.pack_size_used}
        </td>

        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-positive">
          +{entry.good_qty.toLocaleString()}
        </td>

        <td className="py-2.5 px-4 text-right whitespace-nowrap">
          {entry.damaged_qty > 0 ? (
            <div className="inline-flex flex-col items-end">
              <span className="font-mono tabular-nums font-bold text-danger">
                +{entry.damaged_qty.toLocaleString()}
              </span>
              <span className="text-[10px] font-mono text-danger font-semibold">
                {entry.qc_reason_code}
              </span>
              {photos?.length ? (
                <span className="flex gap-1 mt-1">
                  {photos.slice(0, 3).map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer" title={`Damage photo ${i + 1}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={u}
                        alt={`Damage evidence ${i + 1}`}
                        className="w-8 h-8 object-cover rounded border border-damage"
                      />
                    </a>
                  ))}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="font-mono text-muted">0</span>
          )}
        </td>

        <td className="py-2.5 px-4 whitespace-nowrap">
          {entry.pack_override_reason ? (
            <span
              className={`inline-block text-[11px] font-mono font-bold ${
                entry.pack_override_reason === 'PARTIAL_HALF_BOX'
                  ? 'text-accent'
                  : entry.pack_override_reason === 'INNER_BOX_SHORTAGE'
                  ? 'text-danger'
                  : 'text-warning'
              }`}
            >
              {entry.pack_override_reason === 'PARTIAL_HALF_BOX'
                ? 'Half-Box Remainder'
                : entry.pack_override_reason === 'INNER_BOX_SHORTAGE'
                ? 'Inner Shortage Defect'
                : 'Pack Size Changed'}
            </span>
          ) : (
            <span className="text-muted font-mono text-[11px]">—</span>
          )}
        </td>

        <td className="py-2.5 px-4 whitespace-nowrap">
          <div className="flex items-center gap-1.5 text-secondary">
            <User className="w-3.5 h-3.5 text-muted" strokeWidth={1.75} />
            <span className="font-mono text-[11px]">
              {cleanDisplay(entry.operator_user_id || entry.operator_name)}
            </span>
          </div>
        </td>

        <td className="py-2.5 px-4 whitespace-nowrap">
          {isVoided ? (
            <span className="text-[11px] font-mono font-bold text-danger">VOIDED</span>
          ) : (
            <span className="text-[11px] font-mono font-bold text-positive">ACTIVE</span>
          )}
          {isVoided && entry.void_reason && (
            <div className="text-[10px] text-muted mt-0.5 no-underline not-italic">
              &quot;{entry.void_reason}&quot;
            </div>
          )}
        </td>

        <td className="py-2.5 px-4 text-right whitespace-nowrap">
          <div className="flex items-center justify-end gap-1">
            {!isVoided && canMove && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onOpenMove(entry)}
                disabled={disabled}
                className="text-secondary hover:text-accent hover:bg-selection px-2 py-1 text-xs"
                title="Move to another pallet"
              >
                <ArrowRightLeft className="w-3.5 h-3.5 mr-1" strokeWidth={1.75} />
                Move
              </Button>
            )}

            {!isVoided && canVoid && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onOpenVoid(entry.id)}
                disabled={disabled}
                className="text-danger hover:text-danger hover:bg-damage px-2 py-1 text-xs"
                title="Void this entry"
              >
                <Ban className="w-3.5 h-3.5 mr-1" strokeWidth={1.75} />
                Void
              </Button>
            )}
          </div>
        </td>
      </tr>
    );
  },
  (prev, next) =>
    prev.entry === next.entry &&
    prev.item === next.item &&
    prev.pallet === next.pallet &&
    prev.disabled === next.disabled &&
    prev.canVoid === next.canVoid &&
    prev.canMove === next.canMove &&
    prev.photos?.length === next.photos?.length
);

const PalletLedgerMobileCard = React.memo(
  function PalletLedgerMobileCard({
    entry,
    item,
    pallet,
    photos,
    canVoid,
    canMove,
    disabled,
    onOpenVoid,
    onOpenMove,
  }: {
    entry: PalletEntry;
    item: ExpectedItem | undefined;
    pallet: Pallet | undefined;
    photos: string[] | undefined;
    canVoid: boolean;
    canMove: boolean;
    disabled: boolean;
    onOpenVoid: (entryId: string) => void;
    onOpenMove: (entry: PalletEntry) => void;
  }) {
    const isVoided = entry.is_voided;
    const formattedTime = new Date(entry.created_at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    return (
      <div className={`p-4 space-y-2 ${isVoided ? 'opacity-60' : ''}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono font-bold text-ink bg-soft px-2 py-0.5 rounded border border-edge text-xs">
            {pallet?.pallet_code || 'PLT-???'}
          </span>
          <span className="font-mono tabular-nums text-xs text-muted">{formattedTime}</span>
          {isVoided ? (
            <Badge variant="danger" size="sm" className="font-mono">VOIDED</Badge>
          ) : (
            <Badge variant="green" size="sm" className="font-mono">ACTIVE</Badge>
          )}
        </div>
        <div>
          <div className={`font-mono font-bold text-ink ${isVoided ? 'line-through' : ''}`}>
            {item?.sku_code || 'UNKNOWN'}
          </div>
          <div className="text-[11px] text-muted font-medium">
            {item?.product_name || 'Item info unavailable'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums text-sm">
          <span className="text-secondary">
            {entry.cartons_counted} boxes × {entry.pack_size_used}
          </span>
          <span className="font-bold text-positive">+{entry.good_qty.toLocaleString()} good</span>
          {entry.damaged_qty > 0 && (
            <span className="font-bold text-danger">
              +{entry.damaged_qty.toLocaleString()} dmg ({entry.qc_reason_code})
            </span>
          )}
        </div>
        {entry.pack_override_reason && (
          <div className="text-[11px] font-mono font-bold text-secondary">
            {entry.pack_override_reason === 'PARTIAL_HALF_BOX'
              ? 'Half-Box Remainder'
              : entry.pack_override_reason === 'INNER_BOX_SHORTAGE'
                ? 'Inner Shortage Defect'
                : 'Pack Size Changed'}
          </div>
        )}
        {photos?.length ? (
          <span className="flex gap-1">
            {photos.slice(0, 3).map((u, i) => (
              <a key={i} href={u} target="_blank" rel="noreferrer" title={`Damage photo ${i + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={`Damage evidence ${i + 1}`} className="w-10 h-10 object-cover rounded border border-damage" />
              </a>
            ))}
          </span>
        ) : null}
        <div className="text-[11px] text-muted font-mono">
          {cleanDisplay(entry.operator_user_id || entry.operator_name)}
          {isVoided && entry.void_reason ? ` · "${entry.void_reason}"` : ''}
        </div>
        {!isVoided && (canVoid || canMove) && (
          <div className="flex gap-2 pt-1">
            {canMove && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenMove(entry)}
                disabled={disabled}
                className="min-h-[44px] flex-1"
              >
                <ArrowRightLeft className="w-3.5 h-3.5 mr-1" strokeWidth={1.75} />
                Move
              </Button>
            )}
            {canVoid && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onOpenVoid(entry.id)}
                disabled={disabled}
                className="min-h-[44px] flex-1 text-danger hover:text-danger hover:bg-damage border border-damage"
              >
                <Ban className="w-3.5 h-3.5 mr-1" strokeWidth={1.75} />
                Void
              </Button>
            )}
          </div>
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.entry === next.entry &&
    prev.item === next.item &&
    prev.pallet === next.pallet &&
    prev.disabled === next.disabled &&
    prev.canVoid === next.canVoid &&
    prev.canMove === next.canMove &&
    prev.photos?.length === next.photos?.length
);

export const PalletLedgerTable: React.FC<PalletLedgerTableProps> = ({
  entries,
  itemsMap,
  palletsMap,
  palletsList = [],
  selectedItemId,
  canVoid,
  onVoidEntry,
  onMovePallet,
  disabled = false,
  photoUrlsByEntryId,
}) => {
  const [viewMode, setViewMode] = useState<'sku' | 'container'>('sku');
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [targetEntryId, setTargetEntryId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Move pallet modal state
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveEntry, setMoveEntry] = useState<PalletEntry | null>(null);
  const [targetMovePalletId, setTargetMovePalletId] = useState<string>('');
  const [isMoving, setIsMoving] = useState(false);

  // Filter entries based on viewMode
  const displayedEntries = entries.filter((entry) => {
    if (viewMode === 'sku' && selectedItemId) {
      return entry.item_id === selectedItemId;
    }
    return true; // 'container' view shows all entries
  });

  const handleOpenVoidModal = (entryId: string) => {
    setTargetEntryId(entryId);
    setVoidReason('');
    setErrorMessage('');
    setVoidModalOpen(true);
  };

  const handleConfirmVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetEntryId) return;
    if (!voidReason.trim()) {
      setErrorMessage('A mandatory void reason is required for warehouse audit compliance.');
      return;
    }

    try {
      setIsVoiding(true);
      await onVoidEntry(targetEntryId, voidReason.trim());
      setVoidModalOpen(false);
      setTargetEntryId(null);
      setVoidReason('');
    } catch (err: unknown) {
      setErrorMessage(rpcErrorMessage(err, 'Failed to void entry'));
    } finally {
      setIsVoiding(false);
    }
  };

  const handleOpenMoveModal = (entry: PalletEntry) => {
    setMoveEntry(entry);
    const otherPallet = palletsList.find((p) => p.id !== entry.pallet_id);
    setTargetMovePalletId(otherPallet ? otherPallet.id : '');
    setErrorMessage('');
    setMoveModalOpen(true);
  };

  const handleConfirmMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveEntry || !targetMovePalletId || !onMovePallet) return;

    try {
      setIsMoving(true);
      await onMovePallet(moveEntry.id, targetMovePalletId);
      setMoveModalOpen(false);
      setMoveEntry(null);
    } catch (err: unknown) {
      setErrorMessage(rpcErrorMessage(err, 'Failed to reassign pallet.'));
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <div className="flex flex-col bg-white border-t border-line">
      {/* Table Control Header */}
      <div className="px-6 py-3 border-b border-line bg-white flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListFilter className="w-4 h-4 text-muted" strokeWidth={1.75} />
          <span className="text-[13px] font-semibold text-ink">
            Pallet Receiving Ledger
          </span>
          <span className="text-xs font-mono text-muted tabular-nums">
            ({displayedEntries.length} Records)
          </span>
        </div>

        {/* Dual Mode Switcher — flat segmented control */}
        <div className="flex bg-soft rounded-control p-0.5 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setViewMode('sku')}
            className={`px-3 py-1.5 rounded-control transition-colors ${
              viewMode === 'sku'
                ? 'bg-white text-ink font-bold'
                : 'text-secondary hover:text-ink'
            }`}
          >
            Selected Product
          </button>
          <button
            type="button"
            onClick={() => setViewMode('container')}
            className={`px-3 py-1.5 rounded-control transition-colors ${
              viewMode === 'container'
                ? 'bg-white text-ink font-bold'
                : 'text-secondary hover:text-ink'
            }`}
          >
            Full Container
          </button>
        </div>
      </div>

      {/* Ledger Table Container — desktop / tablet */}
      <div className="overflow-x-auto hidden md:block">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-edge bg-white text-[11px] font-bold text-secondary uppercase tracking-wider sticky top-0 z-10">
              <th className="py-2.5 px-4 font-mono">Time</th>
              <th className="py-2.5 px-4 font-mono">Pallet</th>
              <th className="py-2.5 px-4">Product Code &amp; Item</th>
              <th className="py-2.5 px-4 text-right font-mono">Boxes</th>
              <th className="py-2.5 px-4 text-right font-mono">Good Qty</th>
              <th className="py-2.5 px-4 text-right font-mono">QC Defect</th>
              <th className="py-2.5 px-4">Override / Notes</th>
              <th className="py-2.5 px-4">Operator</th>
              <th className="py-2.5 px-4">Status</th>
              <th className="py-2.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {displayedEntries.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-12 text-center text-muted">
                  <Clock className="w-8 h-8 mx-auto mb-2 text-line" strokeWidth={1.75} />
                  <p className="font-semibold text-xs text-secondary">No pallet entries recorded yet.</p>
                  <p className="text-[11px] text-muted mt-0.5">
                    Select a product and use the tally pad above to begin staging stock on the active pallet.
                  </p>
                </td>
              </tr>
            ) : (
              displayedEntries.map((entry) => (
                <PalletLedgerTableRow
                  key={entry.id}
                  entry={entry}
                  item={itemsMap[entry.item_id]}
                  pallet={palletsMap[entry.pallet_id]}
                  photos={photoUrlsByEntryId?.[entry.id]}
                  canVoid={canVoid}
                  canMove={Boolean(onMovePallet && palletsList.length > 1)}
                  disabled={disabled}
                  onOpenVoid={handleOpenVoidModal}
                  onOpenMove={handleOpenMoveModal}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Phase 20: phone layout — the 10-column table becomes stacked
          entry cards under the md breakpoint; same data, same actions. */}
      <div className="overflow-visible md:hidden divide-y divide-line">
        {displayedEntries.length === 0 ? (
          <div className="py-12 text-center text-muted px-4">
            <Clock className="w-8 h-8 mx-auto mb-2 text-line" strokeWidth={1.75} />
            <p className="font-semibold text-xs text-secondary">No pallet entries recorded yet.</p>
            <p className="text-[11px] text-muted mt-0.5">
              Select a product and use the tally pad above to begin staging stock on the active pallet.
            </p>
          </div>
        ) : (
          displayedEntries.map((entry) => (
            <PalletLedgerMobileCard
              key={entry.id}
              entry={entry}
              item={itemsMap[entry.item_id]}
              pallet={palletsMap[entry.pallet_id]}
              photos={photoUrlsByEntryId?.[entry.id]}
              canVoid={canVoid}
              canMove={Boolean(onMovePallet && palletsList.length > 1)}
              disabled={disabled}
              onOpenVoid={handleOpenVoidModal}
              onOpenMove={handleOpenMoveModal}
            />
          ))
        )}
      </div>

      {/* Move Pallet Modal */}
      {moveModalOpen && moveEntry && (
        <Modal
          isOpen={moveModalOpen}
          onClose={() => setMoveModalOpen(false)}
          title="Reassign Stock to Different Pallet"
        >
          <form onSubmit={handleConfirmMove} className="space-y-4">
            <div className="p-3 bg-selection border border-selection text-accent rounded-lg text-xs space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <ArrowRightLeft className="w-4 h-4 text-accent" strokeWidth={1.75} />
                Physical Pallet Transfer
              </p>
              <p className="text-secondary">
                Move entry for product{' '}
                <strong className="font-mono">{itemsMap[moveEntry.item_id]?.sku_code}</strong> ({moveEntry.cartons_counted} cartons, {moveEntry.good_qty + moveEntry.damaged_qty} units) from{' '}
                <strong className="font-mono">{palletsMap[moveEntry.pallet_id]?.pallet_code}</strong> to another open pallet.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-secondary mb-1">
                Target Pallet
              </label>
              <select
                value={targetMovePalletId}
                onChange={(e) => setTargetMovePalletId(e.target.value)}
                required
                className="w-full px-3 py-2 text-xs font-mono font-bold bg-soft border border-edge rounded focus:ring-1 focus:ring-accent focus:outline-none"
              >
                {palletsList
                  .filter((p) => p.id !== moveEntry.pallet_id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.pallet_code} ({p.status.toUpperCase()})
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMoveModalOpen(false)}
                disabled={isMoving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={isMoving || !targetMovePalletId}
              >
                {isMoving ? 'Moving...' : 'Confirm Move Pallet'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Mandatory Reason Void Modal */}
      <Modal
        isOpen={voidModalOpen}
        onClose={() => setVoidModalOpen(false)}
        title="Void Warehouse Pallet Entry"
      >
        <form onSubmit={handleConfirmVoid} className="space-y-4">
          <div className="p-3 bg-attention border border-attention text-warning rounded-lg text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" strokeWidth={1.75} />
            <div>
              <p className="font-bold">Enterprise Audit Trail Notice</p>
              <p className="mt-0.5">
                Voiding will permanently reverse these units from container tallies and audit logs.
                A specific reason is strictly required.
              </p>
            </div>
          </div>

          {errorMessage && (
            <div className="p-3 bg-damage border border-damage text-danger rounded-lg text-xs">
              {errorMessage}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-secondary mb-1">
              Mandatory Void Reason
            </label>
            <textarea
              rows={3}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Scanned wrong box on Pallet 2, re-tallied under correct product"
              required
              className="w-full px-3 py-2 text-xs border border-edge rounded focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setVoidModalOpen(false)}
              disabled={isVoiding}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={isVoiding || !voidReason.trim()}
            >
              {isVoiding ? 'Voiding Entry...' : 'Confirm Void'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
