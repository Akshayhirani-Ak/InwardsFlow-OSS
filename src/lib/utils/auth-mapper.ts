// InwardsFlow Enterprise WMS â€” Auth Identifier Mapping
// InwardsFlow Receiving & Inventory Engine

/**
 * Normalizes user input into a clean alphanumeric User ID.
 * Strips any entered @domain, whitespace, and invalid characters.
 */
export function normalizeUserId(rawInput: string | null | undefined): string {
  if (!rawInput) return '';
  return rawInput
    .trim()
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9._-]/g, '');
}

/**
 * Converts a plain User ID into the deterministic internal Supabase Auth email.
 * Uses `@inwardsflow.com` to satisfy Supabase's strict email TLD validator.
 * This satisfies Supabase's email requirement behind the scenes without ever exposing an email in the UI.
 */
export function toAuthEmail(userId: string): string {
  const clean = normalizeUserId(userId);
  return `${clean}@inwardsflow.com`;
}

/**
 * Strips `@inwardsflow.com` or legacy `@inwardsflow.local` domains
 * to return only the clean User ID for UI display, logs, and database records.
 */
export function toCleanUserId(emailOrId: string | null | undefined): string {
  if (!emailOrId) return '';
  return String(emailOrId)
    .replace(/@inwardsflow\.com$/i, '')
    .replace(/@inwardsflow\.local$/i, '')
    .replace(/@.*$/, '')
    .trim();
}

/**
 * Strips `@inwardsflow.com` or `@inwardsflow.local` from any narrative text or audit detail string.
 */
export function cleanDisplay(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/@inwardsflow\.com/gi, '')
    .replace(/@inwardsflow\.local/gi, '');
}
