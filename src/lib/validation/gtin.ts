// InwardsFlow — GTIN / barcode validation (client mirror of the server
// check added in migration 0007). The server is the authority; this exists
// so intake can promote a verified barcode to the product's primary code
// and flag a misread digit before it poisons the catalog.
//
// GTIN-8 / UPC-A (12) / EAN-13 / GTIN-14 all share one check digit rule:
// weight the data digits 3,1,3,1... starting with 3 for the digit
// immediately left of the check digit; the check digit makes the total a
// multiple of 10.

export function normalizeBarcode(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

export function isGtinShaped(value: string): boolean {
  const n = normalizeBarcode(value);
  return [8, 12, 13, 14].includes(n.length);
}

export function gtinCheckDigit(dataDigits: string): number {
  let sum = 0;
  const digits = normalizeBarcode(dataDigits);
  for (let i = 0; i < digits.length; i++) {
    // i counts from the rightmost data digit: weights 3,1,3,1...
    const digit = parseInt(digits[digits.length - 1 - i], 10);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(value: string): boolean {
  const n = normalizeBarcode(value);
  if (![8, 12, 13, 14].includes(n.length)) return false;
  return gtinCheckDigit(n.slice(0, -1)) === parseInt(n[n.length - 1], 10);
}
