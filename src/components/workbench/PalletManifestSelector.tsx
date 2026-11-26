'use client';

import React, { useEffect, useState } from 'react';
import { rpcErrorMessage } from '@/lib/utils/errors';
import { Pallet } from '@/types/wms';
import { Layers, Plus, Lock, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface PalletManifestSelectorProps {
  pallets: Pallet[];
  selectedPalletId: string | null;
  onSelectPallet: (palletId: string) => void;
  onCreatePallet: () => Promise<void>;
  onToggleSealPallet: (palletId: string, seal: boolean) => Promise<void>;
  palletUnitsMap: Record<string, { good: number; damaged: number; count: number }>;
  disabled?: boolean;
}

export const PalletManifestSelector: React.FC<PalletManifestSelectorProps> = ({
  pallets,
  selectedPalletId,
  onSelectPallet,
  onCreatePallet,
  onToggleSealPallet,
  palletUnitsMap,
  disabled = false,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [isTogglingSeal, setIsTogglingSeal] = useState(false);

  const activePallet = pallets.find((p) => p.id === selectedPalletId) || pallets[0];

  const handleCreateNew = async () => {
    try {
      setIsCreating(true);
      await onCreatePallet();
    } catch (error) {
      window.alert(rpcErrorMessage(error));
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleSeal = async () => {
    if (!activePallet) return;
    try {
      setIsTogglingSeal(true);
      const willSeal = activePallet.status === 'open';
      await onToggleSealPallet(activePallet.id, willSeal);
    } catch (error) {
      window.alert(rpcErrorMessage(error));
    } finally {
      setIsTogglingSeal(false);
    }
  };

  // Hotkeys: F2 (New Pallet), F4 (Toggle Seal)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || document.querySelector('[role="dialog"]')) return;
      if (e.key === 'F2') {
        e.preventDefault();
        if (!disabled && !isCreating) {
          handleCreateNew();
        }
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (!disabled && !isTogglingSeal && activePallet) {
          handleToggleSeal();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const activeUnits = activePallet
    ? palletUnitsMap[activePallet.id] || { good: 0, damaged: 0, count: 0 }
    : { good: 0, damaged: 0, count: 0 };

  return (
    <div className="counting-pallet-strip shrink-0 bg-white border-b border-line px-2 sm:px-6 py-1">
      {/* One centre line per row: the select and both buttons are exactly
          h-12 and the stat blocks are h-12 too, so nothing floats above or
          below its neighbours. The hotkey hints live in the button labels,
          so there is no separate caption row to throw the alignment off.
          On phone widths the bar stacks: pallet controls (the select
          gets the full row width), a one-line figures summary, then
          New and Seal side by side — instead of one crushed row. */}
      <div className="flex flex-col gap-1 lg:flex-row lg:items-center lg:gap-x-2">
        {/* Target Pallet Selector & Switcher — the pallet stays prominent:
            counting onto the wrong pallet is the classic receiving error */}
        <div className="flex w-full items-center gap-2 lg:w-auto lg:min-w-0">
          <Layers className="w-5 h-5 shrink-0 text-muted" strokeWidth={1.75} />
          <span className="hidden text-[13px] font-semibold text-ink min-[720px]:inline">
            Pallet
          </span>
          <select
            aria-label="Target pallet"
            value={selectedPalletId || ''}
            onChange={(e) => onSelectPallet(e.target.value)}
            disabled={disabled}
            className="h-12 min-w-0 flex-1 lg:flex-auto lg:w-48 lg:min-w-36 font-mono text-base font-bold text-ink bg-white border border-edge rounded-control px-2.5 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {pallets.map((p) => {
              const u = palletUnitsMap[p.id] || { good: 0, damaged: 0, count: 0 };
              return (
                <option key={p.id} value={p.id}>
                  {p.pallet_code} ({(u.good + u.damaged).toLocaleString()} units - {p.status.toUpperCase()})
                </option>
              );
            })}
          </select>

          {activePallet && (
            <span
              className={`flex items-center gap-1 font-mono text-xs font-bold ${
                activePallet.status === 'sealed' ? 'text-danger' : 'text-positive'
              }`}
            >
              {activePallet.status === 'sealed' ? (
                <Lock className="w-3 h-3" strokeWidth={1.75} />
              ) : (
                <Unlock className="w-3 h-3" strokeWidth={1.75} />
              )}
              {activePallet.status === 'sealed' ? 'SEALED' : 'OPEN'}
            </span>
          )}

        </div>

        {/* Pallet telemetry + actions — flat figures with hairline
            dividers on desktop; on phones a one-line summary, then
            New / Seal side by side under it. */}
        <div className="flex w-full flex-col gap-1 min-[720px]:flex-row min-[720px]:items-center lg:ml-auto lg:w-auto lg:shrink-0">
          {activePallet && (
            <div className="hidden min-[1200px]:flex items-center gap-2 text-xs font-mono">
              <div className="flex h-12 flex-col justify-center">
                <span className="text-muted block text-[10px] font-semibold leading-tight">Good Units</span>
                <span className="font-bold text-positive text-sm tabular-nums leading-tight">{activeUnits.good.toLocaleString()}</span>
              </div>
              <div className="w-px h-8 bg-line" />
              <div className="flex h-12 flex-col justify-center">
                <span className="text-muted block text-[10px] font-semibold leading-tight">Damaged / QC</span>
                <span className="font-bold text-danger text-sm tabular-nums leading-tight">{activeUnits.damaged.toLocaleString()}</span>
              </div>
              <div className="w-px h-8 bg-line" />
              <div className="flex h-12 flex-col justify-center">
                <span className="text-muted block text-[10px] font-semibold leading-tight">Total on Pallet</span>
                <span className="font-bold text-ink text-sm tabular-nums leading-tight">
                  {(activeUnits.good + activeUnits.damaged).toLocaleString()}
                </span>
              </div>
            </div>
          )}

          {activePallet && (
            <div className="flex items-center gap-1 whitespace-nowrap font-mono text-[11px] text-muted min-[1200px]:hidden">
              <span>Good <span className="font-bold text-positive">{activeUnits.good.toLocaleString()}</span></span>
              <span aria-hidden="true">·</span>
              <span>Damaged <span className="font-bold text-danger">{activeUnits.damaged.toLocaleString()}</span></span>
              <span aria-hidden="true">·</span>
              <span>Total <span className="font-bold text-ink">{(activeUnits.good + activeUnits.damaged).toLocaleString()}</span></span>
            </div>
          )}

          {/* Actions — side by side, full width on phones. On desktop
              the wrapper dissolves (lg:contents) and both buttons join
              the telemetry row next to the figures. */}
          <div className="flex w-full gap-1 min-[720px]:w-auto min-[720px]:shrink-0 lg:contents">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleCreateNew}
              disabled={disabled || isCreating}
              className="h-12 font-mono text-xs px-2 whitespace-nowrap flex-1 lg:flex-none"
            >
              <Plus className="w-3.5 h-3.5 mr-1" strokeWidth={1.75} />
              New Pallet <span className="hidden lg:inline">(F2)</span>
            </Button>

          {activePallet && (
            <Button
              size="sm"
              variant={activePallet.status === 'open' ? 'outline' : 'primary'}
              onClick={handleToggleSeal}
              disabled={disabled || isTogglingSeal}
              className="h-12 text-xs font-semibold px-2 whitespace-nowrap flex-1 lg:flex-none"
            >
              {activePallet.status === 'open' ? (
                <>
                  <Lock className="w-3.5 h-3.5 mr-1.5 text-secondary" strokeWidth={1.75} />
                  Seal Pallet <span className="hidden lg:inline">(F4)</span>
                </>
              ) : (
                <>
                  <Unlock className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.75} />
                  Reopen Pallet <span className="hidden lg:inline">(F4)</span>
                </>
              )}
            </Button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
};
