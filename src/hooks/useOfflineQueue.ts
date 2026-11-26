// InwardsFlow Enterprise WMS â€” Offline Queue Hook for Wi-Fi Dead Zones
// InwardsFlow Receiving & Inventory Engine
//
// Phase 6 rebuild:
//   * Storage is IndexedDB (src/lib/offline/db.ts), not localStorage.
//   * Every queued tally is stamped with the OWNER's auth user id. Only the
//     owner's entries are counted, shown, or flushed â€” on a shared floor
//     tablet, operator B never syncs (or sees) operator A's dead-zone work.
//   * NO FAKE SUCCESS: enqueueing plays the warning sound and the workbench
//     shows a persistent "queued on this device" banner. The verify chime is
//     reserved for tallies the server has actually accepted.
//   * Failures are kept with their error message and attempt count, surfaced
//     via failedCount/lastError, and retried on reconnect â€” never silently
//     discarded, never retried in a hot loop.
//   * Replays call post_tally with the SAME entry UUID, so a lost response
//     can never double-count (server-side idempotency, Phase 2).
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { rpcErrorMessage } from '@/lib/utils/errors';
import { createClient } from '@/lib/supabase/client';
import {
  migrateLegacyQueue,
  queueDelete,
  queueGetAll,
  queuePut,
  type QueuedTally,
} from '@/lib/offline/db';

export interface PostTallyArgs {
  p_entry_id: string;
  p_container_id: string;
  p_pallet_id: string;
  p_item_id: string;
  p_cartons_counted: number;
  p_pack_size_used: number;
  p_partial_carton_qty: number;
  p_good_qty: number;
  p_damaged_qty: number;
  p_qc_status: string;
  p_qc_reason_code: string;
  p_qc_remarks?: string | null;
  p_pack_override_reason?: string | null;
  p_damage_photo_urls?: string[];
}

export function useOfflineQueue(onSynced?: () => void) {
  const [supabase] = useState(() => createClient());
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const flushingRef = useRef<Promise<void> | null>(null);

  const refreshCounts = useCallback(async (uid: string | null) => {
    if (!uid) {
      setPendingCount(0);
      setFailedCount(0);
      return;
    }
    const mine = (await queueGetAll()).filter((e) => e.ownerUserId === uid);
    setPendingCount(mine.length);
    setFailedCount(mine.filter((e) => e.lastError).length);
    const lastFailed = [...mine].reverse().find((e) => e.lastError);
    setLastError(lastFailed?.lastError ?? null);
  }, []);

  const syncPending = useCallback(async () => {
    setIsSyncing(true);
    let syncedAny = false;
    let uid: string | null = null;
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!user) return;
      uid = user.id;
      const pending = (await queueGetAll()).filter((e) => e.ownerUserId === uid && e.status !== 'rejected');
      for (const entry of pending) {
        try {
          const { error } = await supabase.rpc('post_tally', entry.payload);
          if (error) throw error;
          await queueDelete(entry.id);
          syncedAny = true;
        } catch (err: unknown) {
          const errMsg =
            err instanceof Error
              ? err.message
              : typeof err === 'object' && err !== null && 'message' in err
                ? String((err as { message: unknown }).message)
                : 'Sync failed';

          const isPermanent =
            errMsg.includes('not editable') ||
            errMsg.includes('completed') ||
            errMsg.includes('sealed') ||
            errMsg.includes('does not belong') ||
            errMsg.includes('Overcount guard');

          const updated: QueuedTally = {
            ...entry,
            attempts: entry.attempts + 1,
            lastError: errMsg,
            status: isPermanent ? 'rejected' : 'pending',
          };
          await queuePut(updated);
        }
      }
      await refreshCounts(uid);
    } catch (error) {
      setLastError(rpcErrorMessage(error, 'Unable to sync tallies on this device.'));
    } finally {
      setIsSyncing(false);
      if (syncedAny) {

        onSynced?.();
      }
    }
  }, [supabase, refreshCounts, onSynced]);

  const flushQueue = useCallback(() => {
    if (!flushingRef.current) {
      flushingRef.current = syncPending().finally(() => { flushingRef.current = null; });
    }
    return flushingRef.current;
  }, [syncPending]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      setOwnerId(user?.id ?? null);
      if (user) {
        await migrateLegacyQueue(user.id);
        await refreshCounts(user.id);
        if (navigator.onLine) void flushQueue();
      }
    })();

    const handleOnline = () => {
      setIsOnline(true);
      void flushQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);

    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [supabase, refreshCounts, flushQueue]);

  const enqueueTally = useCallback(
    async (payload: PostTallyArgs) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = user?.id ?? ownerId;
      if (!uid) {
        // No identity, no queue â€” never store an orphan tally.
        throw new Error('You are signed out. Tally was NOT saved.');
      }
      await queuePut({
        id: payload.p_entry_id,
        ownerUserId: uid,
        payload: payload as unknown as Record<string, unknown>,
        queuedAt: Date.now(),
        attempts: 0,
      });
      await refreshCounts(uid);
      // Deliberately NOT the success sound: queued is not posted.

    },
    [supabase, ownerId, refreshCounts]
  );

  return {
    isOnline,
    pendingCount,
    failedCount,
    lastError,
    isSyncing,
    enqueueTally,
    flushQueue,
  };
}
