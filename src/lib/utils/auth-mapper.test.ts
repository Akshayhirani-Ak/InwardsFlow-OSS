import { describe, it, expect } from 'vitest';
import { normalizeUserId, toAuthEmail, toCleanUserId, cleanDisplay } from './auth-mapper';

describe('auth-mapper', () => {
  it('normalizes raw input into a clean user id', () => {
    expect(normalizeUserId('  Master@InwardsFlow.com ')).toBe('master');
    expect(normalizeUserId('op.a-1_x')).toBe('op.a-1_x');
    expect(normalizeUserId('weird!!chars')).toBe('weirdchars');
    expect(normalizeUserId(null)).toBe('');
    expect(normalizeUserId(undefined)).toBe('');
  });

  it('builds the deterministic auth email', () => {
    expect(toAuthEmail('master')).toBe('master@inwardsflow.com');
    expect(toAuthEmail(' Master ')).toBe('master@inwardsflow.com');
  });

  it('strips internal domains back to the clean id', () => {
    expect(toCleanUserId('master@inwardsflow.com')).toBe('master');
    expect(toCleanUserId('master@inwardsflow.local')).toBe('master');
    expect(toCleanUserId('master')).toBe('master');
    expect(toCleanUserId(null)).toBe('');
  });

  it('cleans narrative text for display', () => {
    expect(cleanDisplay('posted by master@inwardsflow.com at noon')).toBe('posted by master at noon');
    expect(cleanDisplay(null)).toBe('');
  });
});
