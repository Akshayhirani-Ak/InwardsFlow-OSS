import { expect, it } from 'vitest';
import { supplierAliasPattern } from './supplier-aliases';
it('matches a literal supplier even when its name contains LIKE wildcards or an escape', () => {
  expect(supplierAliasPattern('  A_%\\B  ')).toBe('A\\_\\%\\\\B');
  expect(supplierAliasPattern('Cable Works')).toBe('Cable Works');
});
