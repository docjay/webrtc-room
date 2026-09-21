import { describe, expect, it, vi } from 'vitest';
import {
  readSavedTurnCode,
  saveTurnCode,
  TURN_CODE_STORAGE_KEY,
} from '../src/client/relay-code-storage.js';

function storageFixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  return { storage, values };
}

describe('TURN access-code browser preference', () => {
  it('loads only the saved access code and removes it when cleared', () => {
    const { storage, values } = storageFixture();
    expect(readSavedTurnCode(() => storage)).toEqual({ ok: true, value: '' });
    expect(saveTurnCode('fixture-code', () => storage).ok).toBe(true);
    expect([...values.keys()]).toEqual([TURN_CODE_STORAGE_KEY]);
    expect(readSavedTurnCode(() => storage)).toEqual({ ok: true, value: 'fixture-code' });
    expect(saveTurnCode('replacement-fixture', () => storage).ok).toBe(true);
    expect(readSavedTurnCode(() => storage)).toEqual({ ok: true, value: 'replacement-fixture' });
    expect(saveTurnCode('   ', () => storage).ok).toBe(true);
    expect(values.has(TURN_CODE_STORAGE_KEY)).toBe(false);
  });

  it.each(['getItem', 'setItem'] as const)('reports a failing %s operation', (operation) => {
    const { storage } = storageFixture();
    storage[operation] = () => {
      throw new DOMException('private browser detail', 'QuotaExceededError');
    };
    const result =
      operation === 'getItem'
        ? readSavedTurnCode(() => storage)
        : saveTurnCode('fixture-code', () => storage);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private browser detail');
  });

  it('reports unavailable storage without exposing its raw error', () => {
    const unavailable = () => {
      throw new DOMException('private browser detail', 'SecurityError');
    };
    expect(readSavedTurnCode(unavailable)).toEqual({
      ok: false,
      error: 'Could not load the saved TURN code. You can still enter a code for this tab.',
    });
    expect(saveTurnCode('fixture-code', unavailable)).toEqual({
      ok: false,
      error: 'Could not save the TURN code in this browser. It is only set for this tab.',
    });
  });

  it('does not claim a code was forgotten when removal fails', () => {
    const { storage, values } = storageFixture();
    saveTurnCode('fixture-code', () => storage);
    storage.removeItem = vi.fn(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(saveTurnCode('', () => storage)).toEqual({
      ok: false,
      error: "Could not remove the saved TURN code. Clear this site's browser data to forget it.",
    });
    expect(values.get(TURN_CODE_STORAGE_KEY)).toBe('fixture-code');
  });
});
