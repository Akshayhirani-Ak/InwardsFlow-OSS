import { expect, it, vi } from 'vitest';
import { readAllRows } from './read-all-rows';

it('continues after a server-capped page and includes the final row', async () => {
  const rows = [1, 2, 3];
  const read = vi.fn(async (from: number) => ({ data: rows.slice(from, from + 2), error: null }));
  expect(await readAllRows(read)).toEqual(rows);
  expect(read.mock.calls.map(([from]) => from)).toEqual([0, 2, 3]);
});
it('rejects the entire report if a later page fails', async () => {
  const error = { message: 'Permission denied' };
  await expect(readAllRows(async from => from ? { data: null, error } : { data: [1], error: null })).rejects.toBe(error);
});
