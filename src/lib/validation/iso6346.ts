// InwardsFlow — ISO 6346 container number validation (client mirror of the
// server check in migration 0005). The server is the authority; this exists
// so the operator sees the problem while typing, not after publishing.
//
// ISO 6346: 3-letter owner code + category letter (U/J/Z) + 6 serial digits
// + 1 check digit. Letter values skip multiples of 11 (A=10 ... Z=38);
// weights are 2^position; the weighted sum mod 11 is the check digit
// (remainder 10 is written as 0).

const LETTER_VALUES: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
  K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
  U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

export function normalizeContainerNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isIso6346Shaped(value: string): boolean {
  return /^[A-Z]{4}[0-9]{7}$/.test(normalizeContainerNumber(value));
}

export function iso6346CheckDigit(firstTen: string): number {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = firstTen[i];
    const val = /[A-Z]/.test(ch) ? LETTER_VALUES[ch] : parseInt(ch, 10);
    sum += val * Math.pow(2, i);
  }
  const rem = sum % 11;
  return rem === 10 ? 0 : rem;
}

export function isValidIso6346(value: string): boolean {
  const n = normalizeContainerNumber(value);
  if (!/^[A-Z]{4}[0-9]{7}$/.test(n)) return false;
  return iso6346CheckDigit(n.slice(0, 10)) === parseInt(n[10], 10);
}

/**
 * Returns a human-readable problem, or null when the number is acceptable.
 * Only ISO-shaped numbers on CONTAINER arrivals are held to the standard —
 * courier refs and local unit IDs are not ISO containers and pass.
 */
export function containerNumberIssue(value: string, arrivalType: string): string | null {
  if (arrivalType !== 'CONTAINER') return null;
  if (!isIso6346Shaped(value)) return null;
  if (isValidIso6346(value)) return null;
  return 'This number has the ISO container format but its check digit does not verify — re-check it against the container door plate.';
}
