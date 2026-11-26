// InwardsFlow — Browser Supabase Client (single implementation).
// Config comes only from @/lib/config (env vars). There is no runtime
// /api/config bridge and no sessionStorage fallback: if the env is wrong,
// the app fails loudly instead of silently talking to the wrong project.
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseAnonKey } from '@/lib/config';

let cachedClient: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  if (!cachedClient) {
    cachedClient = createBrowserClient(getSupabaseUrl(), getSupabaseAnonKey());
  }
  return cachedClient;
}

export const createBrowserSupabaseClient = createClient;

/**
 * @deprecated Kept as a compatibility alias for existing callers.
 * Returns the same singleton as createClient() — there is exactly one
 * browser client, so auth state can never split across two clients.
 */
export async function getRuntimeSupabaseClient(): Promise<SupabaseClient> {
  return createClient();
}
