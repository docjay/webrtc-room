import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, type Credentials, type IssuedAttempt } from '../src/client/api.js';

describe('API probe-result client', () => {
  it('preserves HTTP status for safe refresh failure classification', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'service unavailable' }, { status: 502 })),
    );
    try {
      const request = new ApiClient().createRoom();
      await expect(request).rejects.toBeInstanceOf(ApiError);
      await expect(request).rejects.toMatchObject({ status: 502, message: 'service unavailable' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

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

  it('sends and reads camelCase result-model assessment fields', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        complete: true,
        outcome: 'pass',
        connectivity: 'pass',
        protocolVerification: 'unavailable',
        results: [
          {
            participant_id: 'pt_abcdefghijkl',
            outcome: 'pass',
            detail: 'round trip complete',
            selected: null,
            elapsed_ms: 4,
            connectivity: 'pass',
            protocolVerification: 'unavailable',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const credentials: Credentials = {
        roomCode: 'ABC234',
        participantId: 'pt_abcdefghijkl',
        writeToken: 'token-abcdefghijkl',
      };
      const attempt = { id: 'att_abcdefghijkl', generation: 1, manifest: [] } as IssuedAttempt;
      const result = await new ApiClient().probeResult(credentials, attempt, 'pair-turn-udp-0', {
        outcome: 'pass',
        detail: 'round trip complete',
        elapsedMs: 4,
        connectivity: 'pass',
        protocolVerification: 'unavailable',
      });
      expect(result).toMatchObject({ connectivity: 'pass', protocolVerification: 'unavailable' });
      expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toMatchObject({
        connectivity: 'pass',
        protocolVerification: 'unavailable',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
