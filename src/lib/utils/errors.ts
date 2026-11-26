/**
 * InwardsFlow Universal Error Surfacing
 *
 * Warehouse floor rule: when the server refuses an action, the user sees
 * the server's real reason in plain words — never a generic "failed" message
 * that hides it.
 *
 * Handles:
 * - Error instances
 * - PostgREST error objects { message, details, hint, code }
 * - Plain string errors
 * - Network or unknown exceptions
 */
export function rpcErrorMessage(err: unknown, fallback = 'Operation failed.'): string {
  if (!err) return fallback;

  if (err instanceof Error && err.message?.trim()) {
    return err.message.trim();
  }

  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    const message = typeof obj.message === 'string' && obj.message.trim() ? obj.message.trim() : '';
    const details = typeof obj.details === 'string' && obj.details.trim() ? obj.details.trim() : '';
    const hint = typeof obj.hint === 'string' && obj.hint.trim() ? obj.hint.trim() : '';
    const error = typeof obj.error === 'string' && obj.error.trim() ? obj.error.trim() : '';

    if (message && details && details !== message) {
      return `${message} (${details})`;
    }
    if (message) return message;
    if (details) return details;
    if (error) return error;
    if (hint) return hint;
  }

  if (typeof err === 'string' && err.trim()) {
    return err.trim();
  }

  return fallback;
}
