// InwardsFlow — Offline queue storage (IndexedDB via `idb`).
//
// Phase 6: replaces the old localStorage queue. localStorage is synchronous,
// capped around 5 MB, shared across every user of the browser, and silently
// drop-prone under storage pressure — the wrong home for warehouse tallies
// recorded in a Wi-Fi dead zone. IndexedDB is durable, per-origin, and large.
//
// One store: 'tally-queue', keyed by the entry UUID (the same UUID that makes
// post_tally idempotent server-side). Each record carries the OWNER's auth
// user id: a queue belongs to the operator who counted, and a different
// signed-in user must never flush (or even count) someone else's tallies.
import { openDB, type IDBPDatabase } from 'idb';

export interface QueuedTally {
  /** Entry UUID — also the post_tally idempotency key. */
  id: string;
  /** Auth user id of the operator who recorded the tally. */
  ownerUserId: string;
  /** post_tally RPC arguments. */
  payload: Record<string, unknown>;
  queuedAt: number;
  attempts: number;
  lastError?: string;
  status?: 'pending' | 'rejected';
}

const DB_NAME = 'inwardsflow-offline';
const STORE = 'tally-queue';
const LEGACY_KEY = 'inwardsflow_offline_queue';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function queuePut(entry: QueuedTally): Promise<void> {
  const db = await getDb();
  await db.put(STORE, entry);
}

export async function queueGetAll(): Promise<QueuedTally[]> {
  const db = await getDb();
  const all = (await db.getAll(STORE)) as QueuedTally[];
  return all.sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function queueDelete(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

export async function queueCountFor(ownerUserId: string): Promise<number> {
  const all = await queueGetAll();
  return all.filter((e) => e.ownerUserId === ownerUserId && e.status !== 'rejected').length;
}

export async function queueRejectedCountFor(ownerUserId: string): Promise<number> {
  const all = await queueGetAll();
  return all.filter((e) => e.ownerUserId === ownerUserId && e.status === 'rejected').length;
}

/**
 * One-time import of the pre-Phase-6 localStorage queue. Entries written by
 * the Phase 2 build already carry RPC-shaped payloads with p_entry_id; the
 * even older row-shaped payloads are converted or dropped (they predate the
 * server write path and cannot be replayed safely).
 */
export async function migrateLegacyQueue(ownerUserId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    window.localStorage.removeItem(LEGACY_KEY);

    const legacy = JSON.parse(raw) as Array<{ id?: string; payload?: Record<string, unknown>; timestamp?: number }>;
    for (const item of legacy) {
      const p = item?.payload;
      if (!p) continue;
      if (typeof p.p_entry_id === 'string') {
        await queuePut({
          id: p.p_entry_id,
          ownerUserId,
          payload: p,
          queuedAt: item.timestamp ?? Date.now(),
          attempts: 0,
        });
      }
      // Row-shaped legacy payloads (container_id/cartons_counted/...) are
      // dropped deliberately: replaying them through post_tally would need
      // fields they never captured. The app was never live with real data.
    }
  } catch {
    // A corrupt legacy queue must never break the workbench.
  }
}
