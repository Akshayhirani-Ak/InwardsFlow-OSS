import { rpcErrorMessage } from '@/lib/utils/errors';

interface TransferEntry {
  id: string;
  cartons: number;
  goodQty: number;
  packSizeUsed: number;
}
interface TransferRequest {
  p_entry_id: string;
  p_cartons: number;
  p_target_pallet_id: string | null;
  p_new_pallet: boolean;
}
interface Receipt {
  moved_cartons: number;
  moved_good_qty: number;
  target_pallet_id: string;
  target_pallet_code: string;
}
type Transfer = (args: TransferRequest) => PromiseLike<{ data: unknown; error: unknown }>;

export async function moveGoodBoxes(entries: TransferEntry[], wanted: number, destination: string, transfer: Transfer) {
  if (!Number.isSafeInteger(wanted) || wanted < 0) throw new Error('Enter a whole number of boxes.');
  let targetId: string | null = destination === 'NEW' ? null : destination;
  let targetCode: string | null = null;
  let movedBoxes = 0;
  let movedUnits = 0;
  for (const entry of entries) {
    if (movedBoxes === wanted) break;
    if (entry.packSizeUsed <= 0) throw new Error('Invalid pack size. Refresh before moving stock.');
    const take = Math.min(wanted - movedBoxes, entry.cartons, Math.floor(entry.goodQty / entry.packSizeUsed));
    if (take <= 0) continue;
    try {
      const { data, error } = await transfer({ p_entry_id: entry.id, p_cartons: take, p_target_pallet_id: targetId, p_new_pallet: targetId === null });
      if (error) throw error;
      const receipt = data as Partial<Receipt> | null;
      if (!receipt?.target_pallet_id || !receipt.target_pallet_code || receipt.moved_cartons !== take ||
          receipt.moved_good_qty !== take * entry.packSizeUsed || (targetId && receipt.target_pallet_id !== targetId)) {
        throw new Error('The server returned an incomplete transfer receipt.');
      }
      targetId = receipt.target_pallet_id;
      targetCode = receipt.target_pallet_code;
      movedBoxes += receipt.moved_cartons;
      movedUnits += receipt.moved_good_qty;
    } catch (error) {
      throw new Error(`${rpcErrorMessage(error)} Confirmed before this request: ${movedBoxes} boxes. Check the refreshed pallets before retrying.`);
    }
  }
  return { targetId, targetCode, movedBoxes, movedUnits, leftoverBoxes: wanted - movedBoxes };
}
