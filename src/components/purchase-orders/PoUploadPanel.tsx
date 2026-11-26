'use client';

// Phase 29: upload a company PO printout (PDF or photo) and let the AI
// intake read the order off it. One file = one PO. The extraction stages
// in StagedPoGrid for a human check before anything is filed — the PO
// becomes a live balance, so a misread line matters.

import React, { useRef, useState } from 'react';
import { FileUp, Loader2, PenLine } from 'lucide-react';
import type { AiPurchaseOrderResponse } from '@/types/wms';
import { prepareFiles } from '@/lib/intake/prepare';

interface PoUploadPanelProps {
  onExtracted: (po: AiPurchaseOrderResponse) => void;
  onManualEntry: () => void;
}

const ACCEPTED = 'application/pdf,image/png,image/jpeg,image/webp';

function readFileAsBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function PoUploadPanel({ onExtracted, onManualEntry }: PoUploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const processFile = async (file: File) => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      // Phase 36: prepare first, exactly like the delivery intake — a
      // photographed PO printout is far over the sendable size limit
      // and previously died behind "Document processing failed." An
      // oversized PDF arrives here as one image per page; every page
      // is read and the lines are combined into the one PO.
      const { prepared, skipped } = await prepareFiles([file]);
      if (prepared.length === 0) {
        throw new Error(skipped[0]?.reason || 'Document processing failed.');
      }
      const successes: AiPurchaseOrderResponse[] = [];
      const failures: string[] = [];
      for (const entry of prepared) {
        try {
          const res = await fetch('/api/ai-intake', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              documentKind: 'purchase_order',
              fileBase64: await readFileAsBase64(entry.file),
              mimeType: entry.file.type || 'application/pdf',
            }),
          });
          const data = await res.json().catch(() => null);
          if (res.status === 413) {
            throw new Error('This file is too large to send to the AI reader.');
          }
          if (!res.ok || !data?.success) {
            const detailText =
              Array.isArray(data?.details) && data.details.length > 0
                ? `: ${data.details.join('; ')}`
                : '';
            throw new Error(`${data?.error || 'Document processing failed.'}${detailText}`);
          }
          successes.push(data.data as AiPurchaseOrderResponse);
        } catch (err: unknown) {
          failures.push(
            `${entry.file.name}: ${err instanceof Error ? err.message : 'processing failed.'}`
          );
        }
      }
      if (successes.length === 0) {
        throw new Error(failures[0] || 'Document processing failed.');
      }
      const headed =
        successes.find((s) => s.po_number) || successes[0];
      const mergedPo: AiPurchaseOrderResponse = {
        ...headed,
        po_number: headed.po_number || '',
        supplier_name:
          successes.find((s) => s.supplier_name)?.supplier_name || headed.supplier_name,
        order_date:
          successes.find((s) => s.order_date)?.order_date || headed.order_date,
        lines: successes.flatMap((s) => s.lines),
        warnings: [
          ...successes.flatMap((s) => s.warnings || []),
          ...failures.map((f) => `Skipped — ${f}`),
        ],
      };
      onExtracted(mergedPo);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to read the purchase order.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-surface rounded-card shadow-rest">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a purchase order document"
        onClick={() => !isLoading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !isLoading) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !isLoading) void processFile(file);
        }}
        className={`px-5 py-8 text-center cursor-pointer transition-colors ${
          dragOver ? 'bg-selection' : 'bg-white'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void processFile(file);
          }}
        />
        {isLoading ? (
          <Loader2 className="w-8 h-8 mx-auto text-accent animate-spin" strokeWidth={1.75} />
        ) : (
          <FileUp className="w-8 h-8 mx-auto text-secondary" strokeWidth={1.5} />
        )}
        <p className="mt-3 text-sm font-semibold text-ink">
          {isLoading ? 'Reading the purchase order…' : 'Drop the PO printout here, or tap to choose the file'}
        </p>
        <p className="mt-1 text-xs text-muted">
          PDF or photo of the company purchase order. Upload it once — the PO then lives in the app and
          every delivery against it draws the balance down.
        </p>
      </div>

      {errorMessage && (
        <div className="px-5 py-3 border-t border-line bg-damage text-[13px] text-danger">
          {errorMessage}
        </div>
      )}

      <div className="px-5 py-3 border-t border-line flex items-center justify-between">
        <span className="text-xs text-muted">No file handy?</span>
        <button
          type="button"
          onClick={onManualEntry}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline"
        >
          <PenLine className="w-3.5 h-3.5" strokeWidth={1.75} />
          Type the PO in manually
        </button>
      </div>
    </div>
  );
}
