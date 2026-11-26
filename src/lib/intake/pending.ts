// InwardsFlow — Phase 14 pending-container numbers (pure, unit-tested).
//
// Container numbers are UNIQUE in the database (one physical container =
// one record). The AI extraction uses the literal placeholder CONT-PENDING
// when a document states no container number — so the first no-number
// consignment claimed it permanently and every later one failed to
// publish with "Container CONT-PENDING already exists". At publish time
// each placeholder unit gets its own PENDING-<stamp> number instead; the
// operator can type the real number in the grid before publishing
// whenever the freight documents provide it.

export function isPendingPlaceholder(containerNumber: string): boolean {
  return containerNumber.trim().toUpperCase() === 'CONT-PENDING';
}

export function resolveContainerNumbers<T extends { containerNumber: string }>(
  containers: T[],
  stamp: string
): T[] {
  let pendingCount = 0;
  return containers.map((c) => {
    if (!isPendingPlaceholder(c.containerNumber)) return c;
    pendingCount += 1;
    return {
      ...c,
      containerNumber:
        pendingCount === 1 ? `PENDING-${stamp}` : `PENDING-${stamp}-${pendingCount}`,
    };
  });
}

import { rpcErrorMessage } from '@/lib/utils/errors';
export { rpcErrorMessage };

/** Best-effort message from anything a data call throws (Postgrest errors
 * are plain objects, not Error instances — an instanceof check alone
 * swallows their real messages). Delegates to universal rpcErrorMessage. */
export function thrownMessage(err: unknown, fallback: string): string {
  return rpcErrorMessage(err, fallback);
}

/** Translates PostgREST RPC-missing errors into a clear floor message when the PO migration is not applied. */
export function formatPoRpcError(err: unknown, fallback = 'Failed to load purchase orders.'): string {
  if (!err) return fallback;
  const obj = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : null;
  const code = String(obj?.code || '');
  const msg = String(obj?.message || '');
  if (
    code === 'PGRST202' ||
    code === '42883' ||
    msg.toLowerCase().includes('schema cache') ||
    msg.toLowerCase().includes('does not exist')
  ) {
    return 'PO database update not applied yet — migration 20261120000010_phase29_purchase_orders.sql needs to be applied to your Supabase database before purchase order features can be used.';
  }
  return thrownMessage(err, fallback);
}
