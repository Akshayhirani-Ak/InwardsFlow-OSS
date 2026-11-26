import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  queueCountFor,
  queueDelete,
  queueGetAll,
  queuePut,
  type QueuedTally,
} from './db';

// Offline test battery — storage half (Phase 26). The queue lives in
// IndexedDB on the phone: it must keep tallies in order, never duplicate
// an entry id, and keep each operator's tallies separate on a shared
// device.

function entry(id: string, owner: string, queuedAt: number): QueuedTally {
  return {
    id,
    ownerUserId: owner,
    payload: { p_entry_id: id, p_container_id: 'c1' },
    queuedAt,
    attempts: 0,
  };
}

beforeEach(async () => {
  for (const e of await queueGetAll()) await queueDelete(e.id);
});

describe('offline queue storage', () => {
  it('returns tallies in the order they were queued', async () => {
    await queuePut(entry('e2', 'user-a', 200));
    await queuePut(entry('e1', 'user-a', 100));
    await queuePut(entry('e3', 'user-a', 300));
    expect((await queueGetAll()).map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('re-putting the same entry id overwrites — never duplicates', async () => {
    await queuePut(entry('e1', 'user-a', 100));
    await queuePut({ ...entry('e1', 'user-a', 100), attempts: 2, lastError: 'boom' });
    const all = await queueGetAll();
    expect(all).toHaveLength(1);
    expect(all[0].attempts).toBe(2);
    expect(all[0].lastError).toBe('boom');
  });

  it("counts only the owner's tallies on a shared device", async () => {
    await queuePut(entry('a1', 'user-a', 1));
    await queuePut(entry('a2', 'user-a', 2));
    await queuePut(entry('b1', 'user-b', 3));
    expect(await queueCountFor('user-a')).toBe(2);
    expect(await queueCountFor('user-b')).toBe(1);
    expect(await queueCountFor('user-c')).toBe(0);
  });

  it('deletes a synced tally permanently', async () => {
    await queuePut(entry('e1', 'user-a', 1));
    await queueDelete('e1');
    expect(await queueGetAll()).toEqual([]);
  });
});
