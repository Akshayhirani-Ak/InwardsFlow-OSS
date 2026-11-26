import { expect, it, vi } from 'vitest';
import { MAX_UPLOAD_BYTES, prepareFiles } from './prepare';

const pdf = vi.hoisted(() => ({ numPages: 16, getPage: vi.fn(), destroy: vi.fn() }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: 'fixture' },
  getDocument: () => ({ promise: Promise.resolve(pdf) }),
}));

it('rejects a whole oversized PDF when some pages would be omitted', async () => {
  const file = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'packing-slip.pdf', { type: 'application/pdf' });
  const result = await prepareFiles([file]);
  expect(result.prepared).toEqual([]);
  expect(result.skipped).toEqual([{ name: file.name, reason: expect.stringContaining('16 pages') }]);
  expect(pdf.getPage).not.toHaveBeenCalled();
  expect(pdf.destroy).toHaveBeenCalledOnce();
});
