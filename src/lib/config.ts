// InwardsFlow — central runtime configuration.
// ONE place reads environment variables. No hard-coded project URLs or keys
// anywhere else in the codebase: a missing variable is a loud failure at
// startup/first use, never a silent fallback to another project's database.

function required(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        'Set it in Vercel Project Settings → Environment Variables (or .env.local for local dev). See .env.example.'
    );
  }
  return value.trim();
}

export function getSupabaseUrl(): string {
  return required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function getSupabaseAnonKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return required(
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)',
    key
  );
}

/** Server-only. Never import from client components. */
export function getGeminiApiKey(): string {
  return required('GEMINI_API_KEY', process.env.GEMINI_API_KEY);
}

/**
 * Server-only. The AI intake model is PINNED — one model, no runtime
 * fallback chain (a fallback chain hides outages and silently changes cost
 * and output quality). GEMINI_MODEL may override it, but only to a model on
 * this allowlist; anything else fails loudly.
 */
const GEMINI_MODEL_ALLOWLIST = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'] as const;

export function getGeminiModel(): string {
  const requested = process.env.GEMINI_MODEL?.trim();
  if (!requested) return 'gemini-3.5-flash-lite';
  if (!(GEMINI_MODEL_ALLOWLIST as readonly string[]).includes(requested)) {
    throw new Error(
      `GEMINI_MODEL "${requested}" is not on the server allowlist (${GEMINI_MODEL_ALLOWLIST.join(', ')}).`
    );
  }
  return requested;
}

/** Optional Upstash REST config for rate limiting; null when not configured. */
export function getUpstashConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

/** Server-only. Service-role key bypasses RLS — server routes only, never the browser. */
export function getSupabaseServiceRoleKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
}
