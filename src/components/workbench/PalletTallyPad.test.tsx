// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ExpectedItem, Pallet } from '@/types/wms';
import { PalletTallyPad } from './PalletTallyPad';

afterEach(cleanup);
const item = { id: 'line-1', sku_code: 'CABLE', product_name: 'Cable', pack_size: 10, expected_total_qty: 500 } as ExpectedItem;
const pallet = { id: 'p1', pallet_code: 'P01', status: 'open' } as Pallet;
const props = { selectedItem: item, targetPallet: pallet, countedForSelectedSku: 0, onPostTally: vi.fn().mockResolvedValue('posted') };

it('preserves manual boxes on a realtime refresh of the selected product', () => {
  const { rerender } = render(<PalletTallyPad {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Increase Full Boxes Counted' }));
  rerender(<PalletTallyPad {...props} selectedItem={{ ...item }} />);
  expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value).toBe('2');
  expect(screen.queryByText('QC Inspector Remarks')).toBeNull();
  expect(screen.queryByRole('button', { name: /Increase .*Partial Box/ })).toBeNull();
});
const recordButton = () => screen.getByRole('button', { name: /RECORD \+12/i });
it('remembers a confirmed pack for another tally of the product', async () => {
  const { rerender } = render(<PalletTallyPad {...props} />);
  fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '12' } });
  fireEvent.click(recordButton());
  fireEvent.click(screen.getByRole('button', { name: /Confirm Reason .* Record Tally/i }));
  await waitFor(() => expect(props.onPostTally).toHaveBeenCalledTimes(1));
  rerender(<PalletTallyPad {...props} selectedItem={{ ...item, id: 'line-2', sku_code: 'FUSE' }} />);
  rerender(<PalletTallyPad {...props} selectedItem={{ ...item, id: 'line-3' }} />);
  expect((screen.getAllByRole('spinbutton')[1] as HTMLInputElement).value).toBe('12');
  fireEvent.click(recordButton());
  await waitFor(() => expect(props.onPostTally).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('button', { name: /Confirm Reason .* Record Tally/i })).toBeNull();
});
