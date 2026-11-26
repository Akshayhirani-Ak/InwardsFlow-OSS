import { expect, it, vi } from 'vitest';
import { moveGoodBoxes } from './transfer';
import { containerTotals } from './organise';
import type { PalletEntry } from '@/types/wms';

it('reuses the new pallet, conserves boxes and units, and leaves loose and damaged units on source', async () => {
  const entries = [{ id: 'a', cartons: 2, packSizeUsed: 5, goodQty: 7 }, { id: 'b', cartons: 1, packSizeUsed: 5, goodQty: 8 }];
  const stock = entries.map(e => ({ id: e.id, cartons_counted: e.cartons, good_qty: e.goodQty, damaged_qty: e.id === 'a' ? 3 : 0 }));
  const before = containerTotals(stock as PalletEntry[]);
  const targets: (string | null)[] = [];
  const result = await moveGoodBoxes(entries, 3, 'NEW', async args => {
    targets.push(args.p_target_pallet_id);
    expect(args.p_new_pallet).toBe(targets.length === 1);
    const row = stock.find(e => e.id === args.p_entry_id)!;
    row.cartons_counted -= args.p_cartons;
    row.good_qty -= args.p_cartons * 5;
    stock.push({ id: 'dest', cartons_counted: args.p_cartons, good_qty: args.p_cartons * 5, damaged_qty: 0 });
    return { data: { target_pallet_id: 'dest', target_pallet_code: 'P02', moved_cartons: args.p_cartons, moved_good_qty: args.p_cartons * 5 }, error: null };
  });
  expect(targets).toEqual([null, 'dest']);
  expect(result).toEqual({ targetId: 'dest', targetCode: 'P02', movedBoxes: 2, movedUnits: 10, leftoverBoxes: 1 });
  expect(containerTotals(stock as PalletEntry[])).toEqual(before);
  expect(stock.slice(0, 2).map(e => [e.good_qty, e.damaged_qty])).toEqual([[2, 3], [3, 0]]);
});

it('stops on an unconfirmed result without submitting the next entry', async () => {
  const row = { id: 'a', cartons: 1, packSizeUsed: 5, goodQty: 5 };
  const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
  await expect(moveGoodBoxes([row, row], 2, 'NEW', rpc)).rejects.toThrow('incomplete transfer receipt');
  expect(rpc).toHaveBeenCalledTimes(1);
});
