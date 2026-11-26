// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queueDelete, queueGetAll, queuePut } from '@/lib/offline/db';
import type { PostTallyArgs } from './useOfflineQueue';

// Offline test battery — hook half (Phase 26). Drives the REAL
// useOfflineQueue hook against a fake Supabase client and a real
// (in-memory) IndexedDB: enqueue stamps the owner, flush posts each
// tally with its original UUID and deletes it only on success, a failed
// tally is kept with its error and never blocks the rest, and another
// operator's tallies on the same device are never touched.

const state = vi.hoisted(() => ({
  userId: 'user-a' as string | null,
  rpcImpl: (_args: Record<string, unknown>) => ({ error: null as unknown }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.userId ? { id: state.userId } : null },
      }),
    },
    rpc: async (_fn: string, args: Record<string, unknown>) => state.rpcImpl(args),
  }),
}));

vi.mock('@/lib/utils/audio-feedback', () => ({
  soundEffects: {
    playWarning: () => {},
    playNotification: () => {},
  },
}));

import { useOfflineQueue } from './useOfflineQueue';

function payload(id: string): PostTallyArgs {
  return {
    p_entry_id: id,
    p_container_id: 'container-1',
    p_pallet_id: 'pallet-1',
    p_item_id: 'item-1',
    p_cartons_counted: 1,
    p_pack_size_used: 10,
    p_partial_carton_qty: 0,
    p_good_qty: 10,
    p_damaged_qty: 0,
    p_qc_status: 'PASS',
    p_qc_reason_code: 'PASS',
  };
}

beforeEach(async () => {
  state.userId = 'user-a';
  state.rpcImpl = () => ({ error: null });
  for (const e of await queueGetAll()) await queueDelete(e.id);
});

describe('useOfflineQueue', () => {
  it('enqueue stamps the tally with the signed-in owner', async () => {
    // RPC failing: the mount-time auto-flush (online in jsdom) must not be
    // able to clear the queue mid-assertion — a kept tally is what we read.
    state.rpcImpl = () => ({ error: new Error('offline') });
    const { result } = renderHook(() => useOfflineQueue());
    await act(async () => {
      await result.current.enqueueTally(payload('tally-1'));
    });
    expect(result.current.pendingCount).toBe(1);
    const rows = await queueGetAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerUserId).toBe('user-a');
    expect(rows[0].payload.p_entry_id).toBe('tally-1');
  });

  it('flush posts with the SAME entry UUID and deletes only on success', async () => {
    const seen: Array<Record<string, unknown>> = [];
    state.rpcImpl = (args) => {
      seen.push(args);
      return { error: null };
    };
    const { result } = renderHook(() => useOfflineQueue());
    await act(async () => {
      await result.current.enqueueTally(payload('tally-9'));
    });
    await act(async () => {
      await result.current.flushQueue();
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].p_entry_id).toBe('tally-9');
    expect(await queueGetAll()).toEqual([]);
    expect(result.current.pendingCount).toBe(0);
  });

  it('a failed tally is kept with its error and never blocks the rest', async () => {
    state.rpcImpl = (args) =>
      args.p_entry_id === 'bad-1'
        ? { error: new Error('Container is not editable by you') }
        : { error: null };
    const { result } = renderHook(() => useOfflineQueue());
    await act(async () => {
      await result.current.enqueueTally(payload('bad-1'));
      await result.current.enqueueTally(payload('good-2'));
    });
    await act(async () => {
      await result.current.flushQueue();
    });
    const rows = await queueGetAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('bad-1');
    // One or two sync passes may have attempted it (mount auto-flush plus
    // the manual flush) — the invariant is: attempted, error kept, not lost.
    expect(rows[0].attempts).toBeGreaterThanOrEqual(1);
    expect(rows[0].lastError).toContain('not editable');
    expect(result.current.failedCount).toBe(1);
    expect(result.current.pendingCount).toBe(1);
  });

  it("never flushes or counts another operator's tallies", async () => {
    await queuePut({
      id: 'theirs-1',
      ownerUserId: 'user-b',
      payload: { ...payload('theirs-1') } as unknown as Record<string, unknown>,
      queuedAt: Date.now(),
      attempts: 0,
    });
    const seen: Array<Record<string, unknown>> = [];
    state.rpcImpl = (args) => {
      seen.push(args);
      return { error: null };
    };
    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.pendingCount).toBe(0));
    await act(async () => {
      await result.current.flushQueue();
    });
    expect(seen).toHaveLength(0);
    expect(await queueGetAll()).toHaveLength(1);
  });

  it('enqueue while signed out refuses — no orphan tallies', async () => {
    state.userId = null;
    const { result } = renderHook(() => useOfflineQueue());
    await expect(
      act(async () => {
        await result.current.enqueueTally(payload('orphan-1'));
      })
    ).rejects.toThrow('signed out');
    expect(await queueGetAll()).toEqual([]);
  });
});
