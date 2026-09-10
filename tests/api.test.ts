import { describe, expect, it, vi } from 'vitest';
import { ApiClient, type Credentials, type IssuedAttempt } from '../src/client/api.js';

describe('API probe-result client', () => {
  it('clamps late cleanup elapsed time before sending a terminal result', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Promise.resolve(Response.json({ complete: false, results: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const api = new ApiClient('https://diagnostics.example');
      const credentials: Credentials = {
        roomCode: 'ABC234',
        participantId: 'pt_abcdefghijkl',
        writeToken: 'token-abcdefghijkl',
      };
      const attempt = {
        id: 'att_abcdefghijkl',
        generation: 1,
        manifest: [],
      } as unknown as IssuedAttempt;
      await api.probeResult(credentials, attempt, 'pair-direct-0', {
        outcome: 'timeout',
        detail: 'probe timed out',
        elapsedMs: 30_123.9,
      });
      const init = fetchMock.mock.calls[0]![1]!;
      expect(typeof init.body).toBe('string');
      expect(JSON.parse(init.body as string)).toMatchObject({ elapsedMs: 30_000 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
