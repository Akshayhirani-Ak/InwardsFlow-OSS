// InwardsFlow — Phase 36 upload preparation (browser-side).
//
// Why this exists: the AI intake route is reached through the hosting
// platform's request-body limit (~4.5 MB), and the upload travels as
// base64 inside JSON, which inflates a file by ~4/3. A raw file over
// ~2.8 MB therefore never reaches the model at all — it dies at the
// platform edge and the operator saw only "Document processing
// failed." Photographed paperwork — the normal case: a phone photo
// of a PO printout is 5–25 MB — failed every time, while small portal
// PDFs sailed through. Live-proven 22 Nov 2026.
//
// Preparation runs in the browser BEFORE upload:
//   * byte-identical files in one drop are dropped (SHA-256 match) —
//     the same invoice attached under two names counted twice;
//   * an oversized IMAGE is downscaled on a canvas (long edge capped,
//     re-encoded as JPEG) — phone photos shrink ~10× with no legibility
//     loss for document text;
//   * an oversized PDF is rasterised page by page into JPEGs with
//     pdf.js — a PDF that big is a scan/photo bundle in practice. A
//     SMALL PDF keeps its native path untouched, so its text layer
//     still reaches the model exactly as before;
//   * anything that still cannot be sent is skipped with an honest,
//     named reason instead of a generic failure.

/** Raw-file ceiling for a single AI intake call (base64 + JSON safe). */
export const MAX_UPLOAD_BYTES = 2_800_000;

/** Rasterised page target width in pixels — plenty for document OCR. */
const PAGE_TARGET_WIDTH = 1700;
const MAX_PDF_PAGES = 15;

/** A PDF longer than the raster cap: carries the operator-facing skip
 *  reason so prepareFiles can name the page count instead of falling
 *  back to the generic too-large message. */
class OversizedPdfError extends Error {
  readonly skipReason: string;
  constructor(totalPages: number) {
    super(`PDF has ${totalPages} pages, over the ${MAX_PDF_PAGES}-page limit`);
    this.skipReason =
      `this PDF has ${totalPages} pages — only the first ${MAX_PDF_PAGES} can be processed, ` +
      'so the whole document was skipped rather than partly read. ' +
      'Split it into smaller PDFs and add those instead';
  }
}

export function isOversized(size: number): boolean {
  return size > MAX_UPLOAD_BYTES;
}

export interface HashEntry {
  name: string;
  hash: string;
}

export interface DedupePlan {
  keep: number[];
  duplicates: { name: string; duplicateOf: string }[];
}

/** Pure: plan which of a set of hashed files survive exact dedupe. */
export function planHashDedupe(entries: HashEntry[]): DedupePlan {
  const seen = new Map<string, string>();
  const keep: number[] = [];
  const duplicates: { name: string; duplicateOf: string }[] = [];
  entries.forEach((e, i) => {
    const first = seen.get(e.hash);
    if (first !== undefined) {
      duplicates.push({ name: e.name, duplicateOf: first });
    } else {
      seen.set(e.hash, e.name);
      keep.push(i);
    }
  });
  return { keep, duplicates };
}

export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function blobToFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: blob.type || 'image/jpeg' });
}

async function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('image encoding failed'))),
      'image/jpeg',
      quality
    );
  });
}

/** Downscale one image file until it fits (or give up trying). */
async function downscaleImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  let scale = Math.min(1, 2000 / longest);
  for (let attempt = 0; attempt < 3; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToJpeg(canvas, 0.82);
    if (blob.size <= MAX_UPLOAD_BYTES || attempt === 2) {
      return blobToFile(blob, file.name.replace(/\.[^/.]+$/, '') + '.jpg');
    }
    scale *= 0.65;
  }
  throw new Error('image could not be shrunk');
}

/** Rasterise an oversized PDF into one JPEG per page via pdf.js. */
async function rasterisePdf(file: File): Promise<File[]> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.js',
      import.meta.url
    ).toString();
  }
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  if (pdf.numPages > MAX_PDF_PAGES) {
    // Never silently read only the first pages of a longer document:
    // reject the whole file with the page count named, so the operator
    // splits it instead of trusting a partial read.
    const total = pdf.numPages;
    await pdf.destroy();
    throw new OversizedPdfError(total);
  }
  const base = file.name.replace(/\.[^/.]+$/, '');
  const pageCount = pdf.numPages;
  const out: File[] = [];
  for (let p = 1; p <= pageCount; p++) {
    const page = await pdf.getPage(p);
    let scale = PAGE_TARGET_WIDTH / page.getViewport({ scale: 1 }).width;
    let blob: Blob | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas unavailable');
      await page.render({ canvasContext: ctx, viewport }).promise;
      blob = await canvasToJpeg(canvas, 0.8);
      if (blob.size <= MAX_UPLOAD_BYTES) break;
      scale *= 0.65;
      blob = null;
    }
    if (!blob) throw new Error(`page ${p} could not be shrunk`);
    out.push(blobToFile(blob, `${base} — page ${p}.jpg`));
  }
  return out;
}

export interface PreparedFile {
  file: File;
  /** The operator-facing name of the document this file came from. */
  sourceName: string;
}

export interface SkippedFile {
  name: string;
  reason: string;
}

export interface PrepareResult {
  prepared: PreparedFile[];
  skipped: SkippedFile[];
}

/**
 * Prepare a drop of files for AI intake: hash-dedupe, downscale /
 * rasterise oversized documents, and skip — with reasons — anything
 * that cannot be sent. Text/CSV files pass through untouched (they
 * travel as raw text, not base64 documents).
 */
export async function prepareFiles(files: File[]): Promise<PrepareResult> {
  const skipped: SkippedFile[] = [];

  // 1. Exact-duplicate files (same bytes, whatever the names).
  let survivors = files;
  try {
    const entries: HashEntry[] = [];
    for (const f of files) entries.push({ name: f.name, hash: await sha256Hex(f) });
    const plan = planHashDedupe(entries);
    for (const d of plan.duplicates) {
      skipped.push({
        name: d.name,
        reason: `exact duplicate of ${d.duplicateOf} — the same file was counted once`,
      });
    }
    survivors = plan.keep.map((i) => files[i]);
  } catch {
    // Hashing is an optimisation; if it fails, send everything.
    survivors = files;
  }

  // 2. Size preparation per surviving file.
  const prepared: PreparedFile[] = [];
  for (const file of survivors) {
    const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');
    const isImage = file.type.startsWith('image/');
    if (!isPdf && !isImage) {
      prepared.push({ file, sourceName: file.name });
      continue;
    }
    if (!isOversized(file.size)) {
      prepared.push({ file, sourceName: file.name });
      continue;
    }
    try {
      if (isImage) {
        prepared.push({ file: await downscaleImage(file), sourceName: file.name });
      } else {
        const pages = await rasterisePdf(file);
        for (const pageFile of pages) {
          prepared.push({ file: pageFile, sourceName: file.name });
        }
      }
    } catch (err) {
      skipped.push({
        name: file.name,
        reason:
          err instanceof OversizedPdfError
            ? err.skipReason
            : `too large to send (${(file.size / 1_000_000).toFixed(1)} MB) and it could not be shrunk automatically — ` +
              'use the portal-downloaded PDF if there is one, or photograph the pages as JPGs and add those instead',
      });
    }
  }
  return { prepared, skipped };
}
