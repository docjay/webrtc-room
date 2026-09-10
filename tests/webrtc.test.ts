import { describe, expect, it } from 'vitest';
import { iceConfigSchema, type Profile } from '../src/shared/domain.js';
import {
  candidateMatchesProfile,
  candidatePolicy,
  nonOverlapping,
  requestedServers,
  type PairEvidence,
} from '../src/client/webrtc.js';

const pair = (overrides: Partial<PairEvidence> = {}): PairEvidence => ({
  localType: 'relay',
  remoteType: 'relay',
  localProtocol: 'udp',
  remoteProtocol: 'udp',
  localRelayProtocol: 'udp',
  remoteRelayProtocol: 'unavailable',
  ...overrides,
});

const turnProfile = (a: string, b: string): Profile => ({
  id: `profile_${a}_${b}`,
  a,
  b,
  aLabel: a,
  bLabel: b,
  tier: 1,
  status: 'queued',
});

describe('isolated matrix ICE configuration', () => {
  it('serializes signaling polls so response order cannot regress the cursor', async () => {
    let release!: () => void;
    let calls = 0;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const poll = nonOverlapping(async () => {
      calls++;
      await pending;
      return calls;
    });

    const first = poll();
    expect(await poll()).toBeUndefined();
    expect(calls).toBe(1);
    release();
    await first;
    expect(await poll()).toBe(2);
  });

  it('signals only candidates that can prove the requested profile', () => {
    const profile: Profile = {
      id: 'profile_stun',
      a: 'stun-udp-0',
      b: 'direct-udp',
      aLabel: 'STUN',
      bLabel: 'Direct UDP',
      tier: 0,
      status: 'queued',
    };
    expect(candidateMatchesProfile(profile, 'a', { type: 'host', protocol: 'udp' })).toBe(false);
    expect(candidateMatchesProfile(profile, 'a', { type: 'srflx', protocol: 'udp' })).toBe(true);
    expect(candidateMatchesProfile(profile, 'b', { type: 'host', protocol: 'udp' })).toBe(true);
    expect(candidateMatchesProfile(profile, 'b', { type: 'srflx', protocol: 'udp' })).toBe(false);
  });

  it('uses only the selected multi-URL TURN endpoint and forces relay', () => {
    const config = iceConfigSchema.parse({
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
    });
    for (const [endpoint, url] of [
      ['turn-udp-0', 'turn:relay.example:3478?transport=udp'],
      ['turn-tcp-1', 'turn:relay.example:3478?transport=tcp'],
      ['turn-tls-2', 'turns:relay.example:443?transport=tcp'],
    ] as const) {
      const profile: Profile = {
        id: `profile_${endpoint}`,
        a: endpoint,
        b: 'direct-udp',
        aLabel: endpoint,
        bLabel: 'Direct UDP',
        tier: 1,
        status: 'queued',
      };
      const rtc = requestedServers(profile, 'a', config);
      expect(rtc.iceTransportPolicy).toBe('relay');
      expect(rtc.iceServers).toHaveLength(1);
      expect(rtc.iceServers?.[0]?.urls).toBe(url);
    }
  });

  it.each([
    ['udp', pair({ localRelayProtocol: 'udp' })],
    ['tcp', pair({ localRelayProtocol: 'tcp' })],
    ['tls', pair({ localRelayProtocol: 'tls' })],
  ] as const)(
    'accepts local %s TURN evidence and unavailable remote relay protocol',
    (transport, evidence) => {
      expect(
        candidatePolicy(turnProfile(`turn-${transport}-0`, `turn-${transport}-1`), evidence, true),
      ).toBeUndefined();
    },
  );

  it.each([
    ['udp', pair({ localRelayProtocol: 'udp' })],
    ['tcp', pair({ localRelayProtocol: 'tcp' })],
    ['tls', pair({ localRelayProtocol: 'tls' })],
  ] as const)(
    'applies the same local TURN protocol check for guest %s evidence',
    (transport, evidence) => {
      expect(
        candidatePolicy(turnProfile(`turn-${transport}-0`, `turn-${transport}-1`), evidence, false),
      ).toBeUndefined();
    },
  );

  it('rejects missing, mismatched, and TCP-for-TLS local relay protocol evidence', () => {
    const profile = turnProfile('turn-tls-0', 'turn-tls-1');
    expect(candidatePolicy(profile, pair({ localRelayProtocol: 'unavailable' }), true)).toBe(
      'selected pair relay protocol evidence unavailable',
    );
    expect(candidatePolicy(profile, pair({ localRelayProtocol: 'udp' }), true)).toBe(
      'selected pair relay protocol did not match requested endpoint',
    );
    expect(candidatePolicy(profile, pair({ localRelayProtocol: 'tcp' }), true)).toBe(
      'selected pair relay protocol did not match requested endpoint',
    );
  });

  it('requires relay candidate types on both sides despite unavailable remote relay protocol', () => {
    const profile = turnProfile('turn-udp-0', 'turn-udp-1');
    expect(candidatePolicy(profile, pair({ remoteType: 'host' }), true)).toBe(
      'selected pair did not prove requested relay on this side',
    );
    expect(candidatePolicy(profile, pair({ localType: 'host' }), true)).toBe(
      'selected pair did not prove requested relay on this side',
    );
  });

  it.each([
    [true, pair({ remoteType: 'host', localRelayProtocol: 'udp' })],
    [
      false,
      pair({
        localType: 'host',
        remoteType: 'relay',
        localRelayProtocol: 'unavailable',
      }),
    ],
  ] as const)(
    'permits one-sided TURN only when the requesting peer has local proof (%s)',
    (host, evidence) => {
      const profile = turnProfile('turn-udp-0', 'direct-udp');
      expect(candidatePolicy(profile, evidence, host)).toBeUndefined();
    },
  );
});
