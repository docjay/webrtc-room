import { describe, expect, it } from 'vitest';
import { connectivityLabel, protocolVerificationLabel } from '../src/client/probe-presentation.js';

describe('independent connectivity and protocol presentation', () => {
  it('does not turn unavailable protocol stats into failed connectivity', () => {
    expect(connectivityLabel('pass', true)).toBe('Relay connectivity: passed');
    expect(protocolVerificationLabel('unavailable')).toContain('verification unavailable');
    expect(protocolVerificationLabel('unavailable')).not.toContain('failed');
  });
  it('distinguishes full verification, mismatch and actual connection failure', () => {
    expect(protocolVerificationLabel('verified')).toContain('every required relay side');
    expect(protocolVerificationLabel('mismatch')).toContain('differs from the request');
    expect(connectivityLabel('failure', true)).toBe('Relay connectivity: failed');
    expect(connectivityLabel('timeout', true)).toBe('Relay connectivity: timed out');
  });
});
