/** Literal supplier name in Postgres' case-insensitive LIKE filter. */
export function supplierAliasPattern(supplier: string): string {
  return supplier.trim().replace(/[\\_%]/g, char => '\\' + char);
}
