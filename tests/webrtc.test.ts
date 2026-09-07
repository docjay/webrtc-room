import { describe, expect, it } from 'vitest';
import { iceConfigSchema, type Profile } from '../src/shared/domain.js';
import { requestedServers } from '../src/client/webrtc.js';

describe('isolated matrix ICE configuration', () => {
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
