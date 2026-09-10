import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/client/api.js';
import { alignTemporaryTurnCredentials, managedTurnFailure } from '../src/client/managed-turn.js';
import { sanitizeIceConfig, type IceConfig } from '../src/shared/domain.js';

const config = (host: string, order = ['udp', 'tcp', 'tls']): IceConfig => ({
  iceServers: order.map((transport) => ({
    urls: [
      `${transport === 'tls' ? 'turns' : 'turn'}:${host}:${transport === 'tls' ? 443 : 3478}?transport=${transport === 'tls' ? 'tcp' : transport}`,
    ],
    username: `${host}-${transport}`,
    credential: `temporary-${transport}`,
  })),
});

describe('managed TURN refresh alignment', () => {
  it('preserves manifest slot order when the provider rotates hosts and reorders endpoints', () => {
    const reference = config('original.example');
    const fresh = config('fresh.example', ['tls', 'udp', 'tcp']);
    const aligned = alignTemporaryTurnCredentials(reference, fresh);
    expect(aligned.iceServers.map((server) => server.username)).toEqual([
      'fresh.example-udp',
      'fresh.example-tcp',
      'fresh.example-tls',
    ]);
    expect(sanitizeIceConfig(aligned).map((endpoint) => endpoint.id)).toEqual(
      sanitizeIceConfig(reference).map((endpoint) => endpoint.id),
    );
    expect(JSON.stringify(aligned)).not.toContain('original.example');
    expect(
      aligned.iceServers.every((server) =>
        fresh.iceServers.some((returned) => JSON.stringify(returned) === JSON.stringify(server)),
      ),
    ).toBe(true);
  });

  it('prefers exact returned URLs even if another host has the same transport and port', () => {
    const reference = config('original.example', ['udp']);
    const fresh = {
      iceServers: [...config('other.example', ['udp']).iceServers, ...reference.iceServers],
    };
    expect(alignTemporaryTurnCredentials(reference, fresh)).toEqual(reference);
  });

  it('reserves later exact matches before assigning a rotated hostname', () => {
    const unchanged = config('unchanged.example', ['udp']);
    const reference = {
      iceServers: [...config('original.example', ['udp']).iceServers, ...unchanged.iceServers],
    };
    const fresh = {
      iceServers: [...unchanged.iceServers, ...config('rotated.example', ['udp']).iceServers],
    };
    expect(
      alignTemporaryTurnCredentials(reference, fresh).iceServers.map((server) => server.username),
    ).toEqual(['rotated.example-udp', 'unchanged.example-udp']);
  });

  it.each(['port', 'transport', 'ambiguous', 'credentials'] as const)(
    'rejects an incompatible %s change without exposing secrets',
    (change) => {
      const reference = config('original.example', ['udp']);
      let fresh = config('fresh.example', ['udp']);
      if (change === 'port') fresh.iceServers[0]!.urls = ['turn:fresh.example:80?transport=udp'];
      if (change === 'transport') fresh = config('fresh.example', ['tls']);
      if (change === 'ambiguous')
        fresh.iceServers.push(...config('other.example', ['udp']).iceServers);
      if (change === 'credentials') delete fresh.iceServers[0]!.credential;
      expect(() => alignTemporaryTurnCredentials(reference, fresh)).toThrow(/TURN refresh/);
    },
  );

  it('logs only safe HTTP status and allowlisted service errors', () => {
    expect(managedTurnFailure(new ApiError(502, 'password=upstream-private-detail'))).toBe(
      'TURN credential request failed (HTTP 502)',
    );
    expect(
      managedTurnFailure(new ApiError(403, 'The TURN relay access code is incorrect')),
    ).toContain('The TURN relay access code is incorrect');
    expect(managedTurnFailure(new Error('credential=private-value'))).not.toContain(
      'private-value',
    );
    expect(managedTurnFailure(new DOMException('hidden', 'TimeoutError'))).toContain('timed out');
  });
});
