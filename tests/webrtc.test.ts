import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, type Credentials, type IssuedAttempt } from '../src/client/api.js';
import { iceConfigSchema, type Profile } from '../src/shared/domain.js';
import {
  candidateMatchesProfile,
  candidatePolicy,
  classifyProbeFailure,
  nonOverlapping,
  requestedServers,
  runPairedProbe,
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

const credentials: Credentials = {
  roomCode: 'ABCD23',
  participantId: 'pt_abcdefghijkl',
  writeToken: 'fixture-write-token',
};
const attempt: IssuedAttempt = { id: 'att_abcdefghijkl', generation: 1, manifest: [] };

class PendingPeerConnection {
  iceConnectionState: RTCIceConnectionState = 'disconnected';
  iceGatheringState: RTCIceGatheringState = 'complete';
  signalingState: RTCSignalingState = 'stable';
  onicecandidate: RTCPeerConnection['onicecandidate'] = null;
  onicecandidateerror: RTCPeerConnection['onicecandidateerror'] = null;
  onicegatheringstatechange: RTCPeerConnection['onicegatheringstatechange'] = null;
  oniceconnectionstatechange: RTCPeerConnection['oniceconnectionstatechange'] = null;
  onsignalingstatechange: RTCPeerConnection['onsignalingstatechange'] = null;
  ondatachannel: RTCPeerConnection['ondatachannel'] = null;
  close = vi.fn(() => {
    this.iceConnectionState = 'closed';
  });

  getStats() {
    return new Map<string, RTCStats>();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('isolated matrix ICE configuration', () => {
  const failure = (overrides: Partial<Parameters<typeof classifyProbeFailure>[0]> = {}) =>
    classifyProbeFailure({
      requestedCandidateType: 'srflx',
      localRequestedCandidateDiscovered: true,
      remoteDescriptionApplied: true,
      remoteCandidatesAccepted: 1,
      iceConnectionState: 'disconnected',
      channelOpened: false,
      timedOut: true,
      ...overrides,
    });

  it('reports STUN discovery separately from mapped-address connectivity timeout', () => {
    expect(failure()).toBe(
      'STUN address discovery succeeded; mapped-address connectivity timed out (ICE connection=disconnected)',
    );
  });

  it('keeps failure stages factual and prioritized', () => {
    expect(failure({ localRequestedCandidateDiscovered: false })).toBe(
      'No STUN mapped address was observed before the probe deadline',
    );
    expect(
      failure({ requestedCandidateType: 'relay', localRequestedCandidateDiscovered: false }),
    ).toBe('No TURN relay candidate was observed before the probe deadline');
    expect(
      failure({ requestedCandidateType: 'host', localRequestedCandidateDiscovered: false }),
    ).toBe('No local host candidate was observed before the probe deadline');
    expect(failure({ remoteDescriptionApplied: false })).toBe(
      'waiting for remote offer/answer; no remote description was applied before the probe deadline',
    );
    expect(failure({ signalingFailure: 'http' })).toBe(
      'signaling HTTP request failed before probe completion',
    );
    expect(failure({ signalingFailure: 'apply' })).toBe(
      'remote offer, answer, or candidate application failed before probe completion',
    );
  });

  it('distinguishes missing remote candidates and channel opening after ICE', () => {
    expect(failure({ remoteCandidatesAccepted: 0 })).toBe(
      'local candidate discovery completed, but no remote candidates were accepted before the probe deadline',
    );
    expect(failure({ iceConnectionState: 'connected' })).toBe(
      'ICE connected, but the data channel did not open before the probe deadline',
    );
  });

  it('preserves cancellation as cancellation rather than a connectivity timeout', () => {
    expect(failure({ interrupted: 'cancelled' })).toBe('probe cancelled before completion');
  });

  it.each(['timer', 'abort'] as const)(
    'keeps a healthy pending poll as offer/answer waiting at the %s deadline',
    async (deadline) => {
      vi.useFakeTimers();
      vi.stubGlobal('window', globalThis);
      const peer = new PendingPeerConnection();
      vi.stubGlobal(
        'RTCPeerConnection',
        class {
          constructor() {
            return peer;
          }
        },
      );
      let releasePoll!: () => void;
      const pendingPoll = new Promise<{ signals: []; cursor: number }>((resolve) => {
        releasePoll = () => resolve({ signals: [], cursor: 0 });
      });
      const api = new ApiClient();
      vi.spyOn(api, 'pollSignals').mockReturnValue(pendingPoll);
      const controller = new AbortController();
      const messages: string[] = [];
      const result = runPairedProbe({
        api,
        credentials,
        attempt,
        profile: turnProfile('direct-udp', 'stun-udp-0'),
        pairId: 'pair',
        probeId: 'probe',
        peerId: 'peer',
        host: false,
        config: iceConfigSchema.parse({ iceServers: [] }),
        cancelled: () => false,
        deadlineMs: 1_000,
        signal: controller.signal,
        onDiagnostic: ({ message }) => messages.push(message),
      });

      await vi.advanceTimersByTimeAsync(150);
      if (deadline === 'abort') controller.abort(new DOMException('deadline', 'TimeoutError'));
      else await vi.advanceTimersByTimeAsync(1_000);
      const terminal = await result;
      expect(terminal).toMatchObject({
        outcome: 'timeout',
        detail:
          'waiting for remote offer/answer; no remote description was applied before the probe deadline',
      });
      expect(peer.close).toHaveBeenCalledOnce();
      expect(messages.some((message) => message.includes(terminal.detail))).toBe(true);
      expect(messages.some((message) => message.includes('ICE connection=disconnected'))).toBe(
        true,
      );
      expect(vi.getTimerCount()).toBe(0);
      releasePoll();
    },
  );

  it('captures cancellation before closing the peer connection', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    const peer = new PendingPeerConnection();
    vi.stubGlobal(
      'RTCPeerConnection',
      class {
        constructor() {
          return peer;
        }
      },
    );
    const controller = new AbortController();
    controller.abort();
    const result = await runPairedProbe({
      api: new ApiClient(),
      credentials,
      attempt,
      profile: turnProfile('direct-udp', 'stun-udp-0'),
      pairId: 'pair',
      probeId: 'probe',
      peerId: 'peer',
      host: false,
      config: iceConfigSchema.parse({ iceServers: [] }),
      cancelled: () => false,
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      outcome: 'cancelled',
      detail: 'probe cancelled before completion',
    });
    expect(peer.close).toHaveBeenCalledOnce();
  });

  it('closes promptly on a signaling failure and returns its captured stage', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    const peer = new PendingPeerConnection();
    vi.stubGlobal(
      'RTCPeerConnection',
      class {
        constructor() {
          return peer;
        }
      },
    );
    const api = new ApiClient();
    vi.spyOn(api, 'pollSignals').mockRejectedValue(new Error('network'));
    const result = runPairedProbe({
      api,
      credentials,
      attempt,
      profile: turnProfile('direct-udp', 'stun-udp-0'),
      pairId: 'pair',
      probeId: 'probe',
      peerId: 'peer',
      host: false,
      config: iceConfigSchema.parse({ iceServers: [] }),
      cancelled: () => false,
    });

    await vi.advanceTimersByTimeAsync(150);
    await expect(result).resolves.toMatchObject({
      outcome: 'failure',
      detail: 'signaling HTTP request failed before probe completion',
    });
    expect(peer.close).toHaveBeenCalledOnce();
  });

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
