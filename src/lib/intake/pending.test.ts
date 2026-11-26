import { describe, expect, it } from 'vitest';
import { isPendingPlaceholder, resolveContainerNumbers, thrownMessage, formatPoRpcError } from './pending';

describe('pending placeholders', () => {
  it('recognises the placeholder case-insensitively', () => {
    expect(isPendingPlaceholder('CONT-PENDING')).toBe(true);
    expect(isPendingPlaceholder(' cont-pending ')).toBe(true);
    expect(isPendingPlaceholder('TESTCNT0001')).toBe(false);
  });

  it('gives each pending unit a unique number and leaves real ones alone', () => {
    const out = resolveContainerNumbers(
      [
        { containerNumber: 'CONT-PENDING' },
        { containerNumber: 'MSCU1234567' },
        { containerNumber: 'CONT-PENDING' },
      ],
      '483920'
    );
    expect(out.map((c) => c.containerNumber)).toEqual([
      'PENDING-483920',
      'MSCU1234567',
      'PENDING-483920-2',
    ]);
  });
});

describe('thrownMessage', () => {
  it('reads Error instances', () => {
    expect(thrownMessage(new Error('boom'), 'fb')).toBe('boom');
  });

  it('reads Postgrest-style plain objects (the publish bug)', () => {
    expect(
      thrownMessage(
        { message: 'Container CONT-PENDING already exists — 0 percent completed', code: 'P0001' },
        'fb'
      )
    ).toContain('already exists');
  });

  it('falls back for anything else', () => {
    expect(thrownMessage(null, 'fb')).toBe('fb');
    expect(thrownMessage(42, 'fb')).toBe('fb');
  });
});

describe('formatPoRpcError', () => {
  it('detects missing PO RPCs and provides a clear database update message', () => {
    const pgrstError = {
      code: 'PGRST202',
      details: null,
      hint: null,
      message: 'Could not find the function public.list_purchase_orders in the schema cache',
    };
    expect(formatPoRpcError(pgrstError, 'fb')).toContain('PO database update not applied yet');
  });

  it('detects 42883 undefined_function error', () => {
    const pgError = {
      code: '42883',
      message: 'function public.get_purchase_order(p_po_number => text) does not exist',
    };
    expect(formatPoRpcError(pgError, 'fb')).toContain('PO database update not applied yet');
  });

  it('passes through normal error messages', () => {
    expect(formatPoRpcError(new Error('Network timeout'), 'fb')).toBe('Network timeout');
  });
});
