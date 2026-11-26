'use client';

import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  Image as ImageIcon,
  AlertCircle,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  FileCode,
  PlusCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { AiDocumentExtractionResponse, StagedManifestItem } from '@/types/wms';
import { documentRefKey, mergeExtractions } from '@/lib/intake/merge';
import { prepareFiles } from '@/lib/intake/prepare';
import * as XLSX from 'xlsx';

interface AiDocumentDropzoneProps {
  onExtractionSuccess: (data: AiDocumentExtractionResponse) => void;
  onManualEntry?: () => void;
  onDirectManualManifest?: () => void;
  disabled?: boolean;
}

/**
 * Sanitizes errors so that internal Google API model deprecation strings or raw JSON
 * never appear in the UI.
 */
function sanitizeClientErrorMessage(rawMessage?: string): string {
  if (!rawMessage) {
    return 'AI document parsing service is currently unavailable. Please proceed with CSV/Excel upload or manual consignment entry.';
  }
  if (
    /models?\/|gemini|generativelanguage|no longer available|is not found|deprecated|RESOURCE_EXHAUSTED|quotaExceeded|API_KEY_INVALID/i.test(
      rawMessage
    ) ||
    rawMessage.includes('{') ||
    rawMessage.includes('}')
  ) {
    return 'AI document parsing service is currently unavailable. Please proceed with CSV/Excel upload or manual consignment entry.';
  }
  return rawMessage;
}

export const AiDocumentDropzone: React.FC<AiDocumentDropzoneProps> = ({
  onExtractionSuccess,
  onManualEntry,
  onDirectManualManifest,
  disabled = false,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'text'>('upload');
  const [rawText, setRawText] = useState('');
  // Phase 13: a consignment can arrive as several documents — the upload
  // holds a LIST now. `selectedFile` stays as the first-file alias because
  // the spreadsheet direct-parse path is single-file by design.
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const selectedFile = selectedFiles[0] ?? null;
  const [processingNote, setProcessingNote] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSpreadsheetFile = (file: File) => {
    return (
      file.name.endsWith('.csv') ||
      file.name.endsWith('.xlsx') ||
      file.name.endsWith('.xls') ||
      file.type === 'text/csv' ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel'
    );
  };

  const handleFilesSelect = (files: File[]) => {
    const validTypes = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'text/csv',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];

    const valid = files.filter(
      (f) => validTypes.includes(f.type) || isSpreadsheetFile(f)
    );
    if (valid.length === 0) {
      setErrorMessage('Please upload valid PDF, image (PNG/JPEG/WEBP), CSV, or Excel (.xlsx) documents.');
      return;
    }
    setErrorMessage('');
    setSelectedFiles((prev) => {
      const merged = [...prev];
      for (const f of valid) {
        if (!merged.some((p) => p.name === f.name && p.size === f.size)) {
          merged.push(f);
        }
      }
      return merged;
    });
  };

  const removeSelectedFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled || isLoading) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelect(Array.from(e.dataTransfer.files));
    }
  };

  // Direct CSV / Excel spreadsheet parser fallback
  const handleDirectSpreadsheetParse = async () => {
    try {
      setIsLoading(true);
      setErrorMessage('');

      let rows: any[] = [];
      let sourceName = 'Manual Spreadsheet Import';

      if (activeTab === 'upload' && selectedFile) {
        sourceName = selectedFile.name.replace(/\.[^/.]+$/, '');
        const buffer = await selectedFile.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        rows = XLSX.utils.sheet_to_json(ws);
      } else if (rawText.trim()) {
        const wb = XLSX.read(rawText, { type: 'string' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        rows = XLSX.utils.sheet_to_json(ws);
      }

      if (!rows || rows.length === 0) {
        throw new Error('No valid tabular rows detected in spreadsheet or text data.');
      }

      const items: StagedManifestItem[] = rows
        .map((r: any) => {
          const sku = String(
            r['SKU Code'] || r['sku_code'] || r['SKU'] || r['Item'] || r['Part Number'] || r['Product Code'] || ''
          ).trim().toUpperCase();
          const name = String(r['Product Name'] || r['product_name'] || r['Description'] || sku).trim();
          const pack = Number(r['Standard Pack Size'] || r['standard_pack_size'] || r['Pack Size'] || r['pack_size'] || 1);
          const cartons = Number(r['Cartons'] || r['cartons'] || r['Boxes'] || r['expected_cartons'] || 0);
          const totalQty = Number(
            r['Expected Total Qty'] || r['Total Qty'] || r['Qty'] || r['expected_total_qty'] || (cartons * pack) || 0
          );
          const uom = String(r['UOM'] || r['uom'] || 'EA').trim().toUpperCase();

          if (!sku && !name) return null;
          return {
            sku_code: sku || 'SKU-UNKNOWN',
            product_name: name || sku,
            expected_cartons: cartons || (pack > 1 ? Math.ceil(totalQty / pack) : totalQty) || 1,
            pack_size: pack > 0 ? pack : 1,
            expected_total_qty: totalQty || (cartons * pack) || 1,
            uom: uom || 'EA',
            ai_flag: 'OK' as const,
          };
        })
        .filter(Boolean) as StagedManifestItem[];

      if (items.length === 0) {
        throw new Error('Could not identify SKU or Item columns. Please verify column headers or enter items manually.');
      }

      const timestamp = Date.now().toString().slice(-4);
      onExtractionSuccess({
        container_number: `CONT-${timestamp}`,
        supplier_name: sourceName,
        container_size: '40HC',
        document_ref: `IMP-${timestamp}`,
        dock_door: 'DOOR-01',
        counting_mode: 'GUIDED',
        items,
      });
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to parse spreadsheet data.');
    } finally {
      setIsLoading(false);
    }
  };

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1] || result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const postIntake = async (payload: {
    fileBase64?: string;
    mimeType?: string;
    rawText?: string;
  }): Promise<AiDocumentExtractionResponse> => {
    const res = await fetch('/api/ai-intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (res.status === 413) {
      // The platform rejected the body before the route ran — the file
      // was too large to send even after preparation.
      throw new Error(
        'This file is too large to send to the AI reader. Use the portal-downloaded PDF, or photograph the pages as JPGs and add those instead.'
      );
    }
    if (!res.ok || !data?.success) {
      // Phase 19: carry the server's field-level details (e.g. which
      // line and field failed) — the headline alone left whole-document
      // failures undiagnosable from the operator's screen.
      const detailText =
        Array.isArray(data?.details) && data.details.length > 0
          ? `: ${data.details.join('; ')}`
          : '';
      throw new Error(
        sanitizeClientErrorMessage(
          `${data?.error || 'Document processing failed.'}${detailText}`
        )
      );
    }
    return data.data as AiDocumentExtractionResponse;
  };

  const fileToPayload = async (
    file: File
  ): Promise<{ fileBase64?: string; mimeType?: string; rawText?: string }> => {
    // For CSV / text files, extract rawText for robust parsing
    if (
      file.name.endsWith('.csv') ||
      file.type === 'text/csv' ||
      file.type === 'text/plain'
    ) {
      return { rawText: await file.text() };
    }
    return {
      fileBase64: await readFileAsBase64(file),
      mimeType: file.type || 'application/octet-stream',
    };
  };

  const handleProcessDocument = async () => {
    try {
      setIsLoading(true);
      setErrorMessage('');

      if (activeTab === 'text') {
        if (!rawText.trim()) {
          setErrorMessage('Please paste packing list text, CSV, or line items.');
          setIsLoading(false);
          return;
        }
        const result = await postIntake({ rawText: rawText.trim() });
        onExtractionSuccess(result);
        return;
      }

      // Upload tab — Phase 13: one consignment can be several documents.
      if (selectedFiles.length === 0) {
        setErrorMessage('Please select a packing list or bill of lading document first.');
        setIsLoading(false);
        return;
      }

      const hasSpreadsheet = selectedFiles.some((f) => isSpreadsheetFile(f));
      if (hasSpreadsheet) {
        if (selectedFiles.length === 1) {
          // Spreadsheets (CSV/Excel) parse directly with SheetJS, with no AI synthesis of printed totals.
          await handleDirectSpreadsheetParse();
          return;
        }
        setErrorMessage(
          'A spreadsheet/CSV file cannot be combined with other documents. Import the spreadsheet on its own, or remove it and import the PDFs together.'
        );
        setIsLoading(false);
        return;
      }

      // Phase 36: prepare the drop before sending — byte-identical
      // files are dropped, oversized scans/photos are shrunk to a
      // sendable size (they previously died at the platform body limit
      // behind a generic failure), and anything unsendable is skipped
      // with a named reason.
      setProcessingNote('Preparing documents…');
      const { prepared, skipped: prepSkipped } = await prepareFiles(selectedFiles);
      const failureNotes: string[] = prepSkipped.map(
        (s) => `${s.name}: ${s.reason}`
      );
      if (prepared.length === 0) {
        throw new Error(
          prepSkipped[0]
            ? `${prepSkipped[0].name}: ${prepSkipped[0].reason}`
            : 'Document processing failed.'
        );
      }

      // Phase 15: a bundle downloaded from a portal often mixes cover
      // pages and summaries (no product lines) with the real invoice.
      // One such file must not kill the batch — skip it with a warning
      // and stage the rest; fail only when NO file yields a manifest.
      const results: AiDocumentExtractionResponse[] = [];
      let firstFailure: unknown = null;
      // Phase 36: document-number dedupe — the same document extracted
      // twice (re-exported under another name, attached twice) must
      // not stage its lines twice. Same number + same content
      // fingerprint (supplier, line count, total units) = duplicate:
      // counted once, with a warning. Same number + different content
      // (an invoice and its packing list) stages both, also with a
      // warning to check them.
      const seenDocs = new Map<string, { source: string; fingerprint: string }>();
      const dupeWarnings: string[] = [];
      for (let i = 0; i < prepared.length; i++) {
        const { file, sourceName } = prepared[i];
        setProcessingNote(
          prepared.length > 1
            ? `Reading document ${i + 1} of ${prepared.length}: ${file.name}`
            : ''
        );
        try {
          const result = await postIntake(await fileToPayload(file));
          const refKey = documentRefKey(result);
          if (refKey) {
            const fingerprint = `${(result.supplier_name || '').toUpperCase()}|${result.items.length}|${result.items.reduce(
              (s, it) => s + (it.expected_total_qty || 0),
              0
            )}`;
            const seen = seenDocs.get(refKey);
            if (seen && seen.fingerprint === fingerprint) {
              dupeWarnings.push(
                `Skipped — ${sourceName}: same document (${result.document_ref}) as ${seen.source} with identical lines — counted once.`
              );
              continue;
            }
            if (seen) {
              dupeWarnings.push(
                `Two documents state the same document number (${result.document_ref}) but their lines differ — both were staged; check them before publishing.`
              );
            } else {
              seenDocs.set(refKey, { source: sourceName, fingerprint });
            }
          }
          results.push(result);
        } catch (err) {
          if (!firstFailure) firstFailure = err;
          failureNotes.push(
            `${file.name}: ${err instanceof Error ? err.message : 'processing failed.'}`
          );
        }
      }
      if (results.length === 0) {
        throw firstFailure instanceof Error
          ? firstFailure
          : new Error('Document processing failed.');
      }

      const merged = mergeExtractions(results);
      onExtractionSuccess({
        ...merged,
        warnings: [
          ...(merged.warnings || []),
          ...dupeWarnings,
          ...failureNotes.map((n) => `Skipped — ${n}`),
        ],
      });
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'An error occurred during manifest import.';
      setErrorMessage(sanitizeClientErrorMessage(rawMsg));
    } finally {
      setIsLoading(false);
      setProcessingNote('');
    }
  };

  const hasSpreadsheetReady =
    (activeTab === 'upload' && selectedFile && isSpreadsheetFile(selectedFile)) ||
    (activeTab === 'text' && rawText.trim().includes(','));

  return (
    <div className="min-w-0 bg-surface rounded-card shadow-rest p-4 sm:p-6">
      {/* Tab Switcher */}
      <div className="grid grid-cols-2 border-b border-line mb-6">
        <button
          type="button"
          onClick={() => {
            setActiveTab('upload');
            setErrorMessage('');
          }}
          className={`pb-3 px-4 text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'upload'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          <UploadCloud className="w-4 h-4" strokeWidth={1.75} />
          Document Upload (PDF / Image / CSV / Excel)
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('text');
            setErrorMessage('');
          }}
          className={`pb-3 px-4 text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'text'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          <FileText className="w-4 h-4" strokeWidth={1.75} />
          Manifest Text / CSV Import
        </button>
      </div>

      {/* Sanitized Error & Action Notification */}
      {errorMessage && (
        <div className="mb-6 p-4 bg-attention/95 border border-attention rounded-control text-xs space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-1.5 bg-attention rounded-lg text-warning flex-shrink-0 mt-0.5">
              <AlertCircle className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="flex-1 space-y-1">
              <h5 className="font-bold text-warning text-xs">Intake Service Notice</h5>
              <p className="text-warning leading-relaxed">{errorMessage}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-attention/80">
            {hasSpreadsheetReady && (
              <Button
                type="button"
                size="sm"
                onClick={handleDirectSpreadsheetParse}
                disabled={isLoading}
                className="text-xs h-7.5 bg-accent hover:bg-accent text-white font-semibold"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.75} />
                Parse CSV / Excel Directly
              </Button>
            )}

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setActiveTab('text');
                setErrorMessage('');
              }}
              className="text-xs h-7.5 bg-white text-ink border-attention hover:bg-attention font-semibold"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5 text-accent" strokeWidth={1.75} />
              Paste Manifest Text / CSV
            </Button>

            {onManualEntry && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setErrorMessage('');
                  onManualEntry();
                }}
                className="text-xs h-7.5 bg-ink text-white hover:bg-ink font-semibold"
              >
                <PlusCircle className="w-3.5 h-3.5 mr-1.5 text-positive" strokeWidth={1.75} />
                Start Manual Floor Receipt
              </Button>
            )}

            {onDirectManualManifest && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setErrorMessage('');
                  onDirectManualManifest();
                }}
                className="text-xs h-7.5 bg-white text-secondary border-line hover:bg-soft font-semibold"
              >
                <FileCode className="w-3.5 h-3.5 mr-1.5 text-muted" strokeWidth={1.75} />
                Open Blank Staging Grid
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Tab 1: File Dropzone */}
      {activeTab === 'upload' && (
        <div className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-control p-8 text-center cursor-pointer transition-colors ${
              isDragOver
                ? 'border-accent bg-selection/50'
                : selectedFile
                ? 'border-positive bg-received/20'
                : 'border-line hover:border-edge bg-soft/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,image/png,image/jpeg,image/webp,.csv,.xlsx,.xls,text/plain"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFilesSelect(Array.from(e.target.files));
                }
                e.target.value = '';
              }}
            />

            {selectedFiles.length > 0 ? (
              <div className="flex flex-col items-center">
                <CheckCircle2 className="w-10 h-10 text-positive mb-2" strokeWidth={1.75} />
                <div className="space-y-1">
                  {selectedFiles.map((f, i) => (
                    <p key={`${f.name}-${f.size}`} className="text-sm font-bold text-ink font-mono flex items-center gap-2">
                      {f.name}
                      <span className="text-xs font-normal text-muted">
                        {(f.size / 1024).toFixed(1)} KB
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSelectedFile(i);
                        }}
                        className="text-xs font-semibold text-danger hover:underline"
                      >
                        Remove
                      </button>
                    </p>
                  ))}
                </div>
                <p className="text-xs text-muted mt-1">
                  {selectedFiles.length} document{selectedFiles.length > 1 ? 's' : ''} — Ready for Import as ONE consignment
                </p>
                <span className="text-xs text-accent font-medium mt-2 underline">
                  Click or drag to add more documents
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="p-3 bg-surface rounded-card shadow-rest rounded-full mb-3">
                  <UploadCloud className="w-6 h-6 text-accent" strokeWidth={1.75} />
                </div>
                <h4 className="text-sm font-bold text-ink">
                  Drop Bill of Lading, Packing List or Supplier Manifest
                </h4>
                <p className="text-xs text-muted mt-1">
                  Supports PDF, PNG, JPG, WEBP, CSV, or Excel files — large scans and photos are shrunk automatically so they can be read
                </p>
                <p className="text-xs text-muted mt-1">
                  One consignment in several documents? Select them all — invoice + packing list import together.
                </p>
                <div className="flex items-center gap-3 mt-4 text-[11px] font-mono text-muted">
                  <span className="flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5" strokeWidth={1.75} /> PDF Manifests
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <ImageIcon className="w-3.5 h-3.5" strokeWidth={1.75} /> Scans &amp; Photos
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <FileSpreadsheet className="w-3.5 h-3.5" strokeWidth={1.75} /> Supplier CSV / Excel
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Raw Text Paste */}
      {activeTab === 'text' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-secondary">
              Paste Manifest / Packing Slip Text / CSV Data
            </label>
            {rawText.trim().includes(',') && (
              <button
                type="button"
                onClick={handleDirectSpreadsheetParse}
                className="text-[11px] font-bold text-accent hover:underline flex items-center gap-1"
              >
                <FileSpreadsheet className="w-3 h-3" /> Parse as CSV Table
              </button>
            )}
          </div>
          <textarea
            rows={8}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste text from email, CSV, or ERP packing slip... e.g.:&#10;Container: MSCU-902184-7&#10;Supplier: Apex Industrial Supplies&#10;SKU-9921 | Impact Driver Kit | 50 ctn | 10 per ctn | 500 total&#10;SKU-4410 | Hex Nut Bolt Sets | 120 ctn | 20 per ctn | 2400 total&#10;&#10;Or paste CSV table headers: SKU, Product Name, Cartons, Pack Size, Total Qty"
            className="w-full px-3 py-2 text-xs font-mono bg-soft border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-accent leading-relaxed"
          />
        </div>
      )}

      {/* Extraction Notice & Process CTA */}
      <div className="mt-6 pt-4 border-t border-line flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs text-muted">
          <FileCode className="w-4 h-4 text-accent flex-shrink-0" strokeWidth={1.75} />
          <span>
            Automated digital intake with confidential price and commercial data filtering.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasSpreadsheetReady && (
            <Button
              type="button"
              variant="outline"
              onClick={handleDirectSpreadsheetParse}
              disabled={disabled || isLoading}
              className="text-xs font-semibold text-secondary border-line hover:bg-soft"
            >
              <FileSpreadsheet className="w-4 h-4 mr-1.5 text-accent" strokeWidth={1.75} />
              Import CSV / Excel Directly
            </Button>
          )}

          <Button
            type="button"
            variant="primary"
            onClick={handleProcessDocument}
            disabled={disabled || isLoading || (activeTab === 'upload' ? selectedFiles.length === 0 : !rawText.trim())}
            className="shadow-sm font-bold"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" strokeWidth={1.75} />
                {processingNote || 'Processing Manifest...'}
              </>
            ) : (
              <>
                <FileText className="w-4 h-4 mr-2" strokeWidth={1.75} />
                Import Packing List
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

