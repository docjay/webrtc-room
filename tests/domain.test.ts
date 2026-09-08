import { describe, expect, it } from 'vitest';
import {
  buildProfiles,
  createId,
  diagnosticEventSchema,
  goodputMbps,
  iceConfigSchema,
  iceProfileLabel,
  iceServerAddress,
  nextProfiles,
  percentile,
  redact,
  sanitizeIceConfig,
  profileTier,
  randomIdSource,
  selectEligibleProfile,
  type Profile,
} from '../src/shared/domain.js';
import { transition } from '../src/shared/lifecycle.js';
describe('domain rules', () => {
  it('creates strong browser IDs when randomUUID is unavailable', () => {
    let next = 0;
    const source = {
      getRandomValues: <T extends ArrayBufferView>(array: T) => {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        bytes.forEach((_, index) => {
          bytes[index] = next++;
        });
        return array;
      },
    };
    expect(randomIdSource(source)).toBe('000102030405060708090a0b0c0d0e0f');
    expect(createId('run', () => randomIdSource(source))).toBe(
      'run_101112131415161718191a1b1c1d1e1f',
    );
  });
  it('rejects invalid ICE and removes credentials from diagnostics', () => {
    expect(
      iceConfigSchema.safeParse({
        iceServers: [{ urls: 'turn:relay.example:3478', username: 'u', credential: 'secret' }],
      }).success,
    ).toBe(true);
    expect(iceConfigSchema.safeParse({ iceServers: [{ urls: 'http://bad' }] }).success).toBe(false);
    expect(
      JSON.stringify(
        redact({ nested: { credential: 'hunter2' }, message: 'token=abc password=xyz' }),
      ),
    ).not.toMatch(/hunter2|abc|xyz/);
  });
  it('enforces lifecycle and deterministic matrix scheduling', () => {
    expect(() => transition('idle', 'connected')).toThrow();
    const caps = sanitizeIceConfig(
      iceConfigSchema.parse({
        iceServers: [{ urls: 'turns:a.example:443?transport=tcp', username: 'u', credential: 'c' }],
      }),
    );
    const profiles = buildProfiles(caps, caps);
    expect(profiles.length).toBeGreaterThan(1);
    const scheduled = nextProfiles(
      profiles,
      3,
      10_000,
      new Map(profiles.map((p) => [p.id, 9_000])),
    );
    expect(scheduled).toHaveLength(3);
    expect(scheduled[0]?.queuedMs).toBe(1_000);
    expect(scheduled[0]?.deadlineAt).toBe(40_000);
  });
  it('keeps every sanitized TURN URL as a distinct endpoint pair', () => {
    const a = sanitizeIceConfig(
      iceConfigSchema.parse({
        iceServers: [
          {
            urls: ['turn:a.example:3478?transport=udp', 'turn:a-alt.example:3478?transport=udp'],
            username: 'a',
            credential: 'secret-a',
          },
        ],
      }),
    );
    const b = sanitizeIceConfig(
      iceConfigSchema.parse({
        iceServers: [
          {
            urls: ['turn:b.example:3478?transport=udp', 'turn:b-alt.example:3478?transport=udp'],
            username: 'b',
            credential: 'secret-b',
          },
        ],
      }),
    );
    const pairs = buildProfiles(a, b).filter(
      (profile) => profile.a.startsWith('turn-') && profile.b.startsWith('turn-'),
    );
    expect(pairs).toHaveLength(4);
    expect(new Set(pairs.map((profile) => profile.id)).size).toBe(4);
    expect(pairs.every((profile) => profile.tier === 1)).toBe(true);
    expect(a.map((endpoint) => endpoint.urls)).toEqual([
      ['turn:a.example:3478?transport=udp'],
      ['turn:a-alt.example:3478?transport=udp'],
    ]);
  });
  it('isolates mixed URLs into UDP, TCP, and TLS endpoint identities', () => {
    const endpoints = sanitizeIceConfig(
      iceConfigSchema.parse({
        iceServers: [
          {
            urls: [
              'turn:relay.example:3478?transport=udp',
              'turn:relay.example:3478?transport=tcp',
              'turns:relay.example:443?transport=tcp',
            ],
            username: 'user',
            credential: 'secret',
          },
        ],
      }),
    );
    expect(endpoints.map((endpoint) => [endpoint.id, endpoint.urls[0]])).toEqual([
      ['turn-udp-0', 'turn:relay.example:3478?transport=udp'],
      ['turn-tcp-1', 'turn:relay.example:3478?transport=tcp'],
      ['turn-tls-2', 'turns:relay.example:443?transport=tcp'],
    ]);
  });
  it('labels each ICE profile with its credential-free server address', () => {
    const config = iceConfigSchema.parse({
      iceServers: [
        { urls: 'stun:stun.example:3478' },
        {
          urls: 'turns:relay.example:443?transport=tcp',
          username: 'user',
          credential: 'secret',
        },
      ],
    });

    expect(iceServerAddress('stun:stun.example:3478')).toBe('stun.example:3478');
    expect(iceProfileLabel('stun-udp-0', config)).toBe('STUN stun.example:3478');
    expect(iceProfileLabel('turn-tls-0', config)).toBe('TURN relay.example:443 (TLS)');
    expect(iceProfileLabel('direct-udp', config)).toBe('Direct UDP');
    expect(iceProfileLabel('missing', config)).toBe('missing');
    expect(iceProfileLabel('turn-tls-0', config)).not.toContain('secret');
  });
  it('calculates bounded measurements', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBe(5);
    expect(goodputMbps(125_000, 1000)).toBe(1);
  });
  it('ranks a mixed path by its weakest hop and only selects after better tiers end', () => {
    expect(profileTier('direct-udp', 'turn-tcp')).toBe(3);
    expect(profileTier('stun-udp-0', 'turn-tls')).toBe(2);
    expect(profileTier('turn-udp', 'direct-udp')).toBe(1);
    expect(profileTier('turn-tls-0', 'turn-tcp-1')).toBe(3);
    expect(profileTier('turn-udp-0', 'turn-tls-1')).toBe(2);
    expect(profileTier('direct-tcp', 'direct-udp')).toBe(4);
    expect(profileTier('direct-tcp', 'turn-udp-0')).toBe(4);
    const rows: Array<Profile & { outcome?: string }> = [
      { id: 'profile-z', a: 'direct-udp', b: 'direct-udp', tier: 0, status: 'running' as const },
      {
        id: 'profile-b',
        a: 'turn-udp',
        b: 'turn-udp',
        tier: 1,
        status: 'terminal' as const,
        outcome: 'pass',
      },
      {
        id: 'profile-a',
        a: 'turn-udp',
        b: 'turn-udp',
        tier: 1,
        status: 'terminal' as const,
        outcome: 'pass',
      },
    ];
    expect(selectEligibleProfile(rows)).toBeUndefined();
    rows[0] = { ...rows[0]!, status: 'terminal' };
    expect(selectEligibleProfile(rows)?.id).toBe('profile-a');
  });
  it('allowlists diagnostic payloads', () => {
    expect(
      diagnosticEventSchema.safeParse({
        runId: 'run_abcdefghijkl',
        spanId: 'span',
        sequence: 0,
        type: 'operation',
        outcome: 'start',
        elapsedMs: 0,
        clientTime: '2026-01-01T00:00:00.000Z',
        payload: { sdp: 'secret' },
      }).success,
    ).toBe(false);
  });
});
