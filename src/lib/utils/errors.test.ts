import { describe, it, expect } from 'vitest';
import { rpcErrorMessage } from './errors';

describe('rpcErrorMessage', () => {
  it('returns standard Error message', () => {
    expect(rpcErrorMessage(new Error('Container is sealed'))).toBe('Container is sealed');
  });

  it('extracts PostgREST error object message', () => {
    const postgrestErr = {
      code: 'P0001',
      message: 'Container has been finalized and cannot be modified.',
      details: null,
      hint: null,
    };
    expect(rpcErrorMessage(postgrestErr)).toBe(
      'Container has been finalized and cannot be modified.'
    );
  });

  it('combines message and details when both are present and distinct', () => {
    const postgrestErr = {
      message: 'Foreign key violation',
      details: 'Key (container_id)=(123) is not present in table containers',
    };
    expect(rpcErrorMessage(postgrestErr)).toBe(
      'Foreign key violation (Key (container_id)=(123) is not present in table containers)'
    );
  });

  it('handles string errors', () => {
    expect(rpcErrorMessage('Network timeout connecting to server')).toBe(
      'Network timeout connecting to server'
    );
  });

  it('falls back to fallback message when err is null or empty', () => {
    expect(rpcErrorMessage(null, 'Custom fallback')).toBe('Custom fallback');
    expect(rpcErrorMessage(undefined, 'Custom fallback')).toBe('Custom fallback');
    expect(rpcErrorMessage({}, 'Custom fallback')).toBe('Custom fallback');
  });
});
