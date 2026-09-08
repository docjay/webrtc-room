import { describe, expect, it } from 'vitest';
import { iceConfigSchema, type Profile } from '../src/shared/domain.js';
import { candidateMatchesProfile, nonOverlapping, requestedServers } from '../src/client/webrtc.js';

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
        tier: 1,
        status: 'queued',
      };
      const rtc = requestedServers(profile, 'a', config);
      expect(rtc.iceTransportPolicy).toBe('relay');
      expect(rtc.iceServers).toHaveLength(1);
      expect(rtc.iceServers?.[0]?.urls).toBe(url);
    }
  });
});
