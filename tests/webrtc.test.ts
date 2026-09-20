import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, type Credentials, type IssuedAttempt } from '../src/client/api.js';
import { iceConfigSchema, type Profile } from '../src/shared/domain.js';
import {
  candidateMatchesProfile,
  candidatePolicy,
  classifyProbeFailure,
  extractSelectedPair,
  localProtocolVerification,
  nonOverlapping,
  relayConnectivityPolicy,
  requestedServers,
  runPairedProbe,
  selectedPair,
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

  it('populates assessment fields when RTC setup fails before a probe starts', async () => {
    vi.stubGlobal(
      'RTCPeerConnection',
      class {
        constructor() {
          throw new DOMException('unsupported', 'NotSupportedError');
        }
      },
    );
    const result = await runPairedProbe({
      api: new ApiClient(),
      credentials,
      attempt,
      profile: turnProfile('turn-tcp-0', 'direct-udp'),
      pairId: 'pair',
      probeId: 'probe',
      peerId: 'peer',
      host: true,
      config: iceConfigSchema.parse({ iceServers: [] }),
      cancelled: () => false,
    });
    expect(result).toMatchObject({
      outcome: 'failure',
      connectivity: 'failure',
      protocolVerification: 'not-tested',
    });
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

  it('separates usable relay connectivity from missing or mismatched local access protocol', () => {
    const profile = turnProfile('turn-tls-0', 'turn-tls-1');
    expect(
      candidatePolicy(profile, pair({ localRelayProtocol: 'unavailable' }), true),
    ).toBeUndefined();
    expect(
      localProtocolVerification(profile, pair({ localRelayProtocol: 'unavailable' }), true),
    ).toBe('unavailable');
    expect(localProtocolVerification(profile, pair({ localRelayProtocol: 'udp' }), true)).toBe(
      'mismatch',
    );
    expect(localProtocolVerification(profile, pair({ localRelayProtocol: 'tcp' }), true)).toBe(
      'mismatch',
    );
    expect(localProtocolVerification(profile, pair({ localRelayProtocol: 'tls' }), true)).toBe(
      'verified',
    );
    expect(localProtocolVerification(profile, pair({ localRelayProtocol: 'tls' }), false)).toBe(
      'verified',
    );
    expect(localProtocolVerification(turnProfile('direct-udp', 'turn-tls-1'), pair(), true)).toBe(
      'not-applicable',
    );
  });

  it('requires only this side relay evidence; its peer validates its own role', () => {
    const profile = turnProfile('turn-udp-0', 'turn-udp-1');
    expect(
      relayConnectivityPolicy(profile, pair({ remoteType: 'host' }), true, true, true),
    ).toBeUndefined();
    expect(relayConnectivityPolicy(profile, pair({ localType: 'host' }), true, true, true)).toBe(
      'selected pair did not prove requested relay on this side',
    );
  });

  it('accepts a working relay-only path with missing selected linkage when local relay gathering corroborates it', () => {
    const profile = turnProfile('turn-tcp-0', 'turn-tcp-1');
    expect(relayConnectivityPolicy(profile, undefined, true, true, true)).toBeUndefined();
    expect(relayConnectivityPolicy(profile, undefined, true, false, true)).toBe(
      'no local TURN relay candidate was observed before application verification',
    );
    expect(relayConnectivityPolicy(profile, pair({ localType: 'host' }), true, true, true)).toBe(
      'selected pair did not prove requested relay on this side',
    );
    expect(
      relayConnectivityPolicy(profile, pair({ localType: 'unavailable' }), true, true, true),
    ).toBeUndefined();
    expect(relayConnectivityPolicy(profile, pair(), true, true, false)).toBe(
      'relay-only ICE policy was not configured on this side',
    );
  });

  it('keeps mixed nonrelay roles strict rather than accepting the opposite TURN path', () => {
    const mixed = turnProfile('direct-udp', 'turn-tcp-0');
    expect(relayConnectivityPolicy(mixed, undefined, true, false, false)).toBe(
      'selected pair stats unavailable',
    );
    expect(relayConnectivityPolicy(mixed, pair({ localType: 'srflx' }), true, false, false)).toBe(
      'selected pair did not prove requested direct path on this side',
    );
    expect(
      relayConnectivityPolicy(mixed, pair({ localType: 'host' }), true, false, false),
    ).toBeUndefined();
    const stunMixed = turnProfile('stun-udp-0', 'turn-tcp-0');
    expect(
      relayConnectivityPolicy(stunMixed, pair({ localType: 'host' }), true, false, false),
    ).toContain('local host candidate');
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

  it('prefers transport linkage, then selected flag, then one nominated+succeeded pair', () => {
    const candidate = (type: string, relayProtocol = 'unavailable') => ({
      type: 'local-candidate',
      candidateType: type,
      protocol: 'udp',
      relayProtocol,
    });
    const pairStat = (id: string, selected?: boolean) => ({
      id,
      type: 'candidate-pair',
      state: 'succeeded',
      nominated: true,
      ...(selected === undefined ? {} : { selected }),
      localCandidateId: `local-${id}`,
      remoteCandidateId: `remote-${id}`,
    });
    const transport = new Map<string, unknown>([
      ['transport', { type: 'transport', selectedCandidatePairId: 'second' }],
      ['first', pairStat('first', true)],
      ['second', pairStat('second')],
      ['local-first', candidate('host')],
      ['remote-first', candidate('host')],
      ['local-second', candidate('relay', 'tls')],
      ['remote-second', candidate('relay')],
    ]) as RTCStatsReport;
    expect(extractSelectedPair(transport)).toMatchObject({
      source: 'transport-link',
      pair: { localType: 'relay' },
    });

    const flagged = new Map<string, unknown>([
      ['only', pairStat('only', true)],
      ['local-only', candidate('relay', 'tcp')],
      ['remote-only', candidate('host')],
    ]) as RTCStatsReport;
    expect(extractSelectedPair(flagged).source).toBe('selected-flag');
    const dangling = new Map<string, unknown>([
      ['transport', { type: 'transport', selectedCandidatePairId: 'absent' }],
      ['old', pairStat('old', true)],
    ]) as RTCStatsReport;
    expect(extractSelectedPair(dangling).source).toBe('missing-linkage');
    const conflictingFlags = new Map<string, unknown>([
      ['old', { ...pairStat('old', true), nominated: false }],
      ['current', pairStat('current', true)],
    ]) as RTCStatsReport;
    expect(extractSelectedPair(conflictingFlags).source).toBe('missing-linkage');

    const fallback = new Map<string, unknown>([
      ['only', pairStat('only')],
      ['local-only', candidate('relay', 'tcp')],
      ['remote-only', candidate('host')],
    ]) as RTCStatsReport;
    expect(extractSelectedPair(fallback).source).toBe('nominated-fallback');
    (fallback as unknown as Map<string, unknown>).set('other', pairStat('other'));
    expect(extractSelectedPair(fallback)).toEqual({ source: 'missing-linkage' });

    (transport as unknown as Map<string, unknown>).set('second-transport', {
      type: 'transport',
      selectedCandidatePairId: 'first',
    });
    expect(extractSelectedPair(transport).source).toBe('missing-linkage');
  });

  it('briefly resamples incomplete selected relay stats for late local details', async () => {
    vi.useFakeTimers();
    const partial = new Map<string, unknown>([
      ['pair', { id: 'pair', type: 'candidate-pair', selected: true, localCandidateId: 'local' }],
      ['local', { type: 'local-candidate', candidateType: 'relay', protocol: 'udp' }],
    ]) as RTCStatsReport;
    const complete = new Map<string, unknown>([
      ['pair', { id: 'pair', type: 'candidate-pair', selected: true, localCandidateId: 'local' }],
      [
        'local',
        {
          type: 'local-candidate',
          candidateType: 'relay',
          protocol: 'udp',
          relayProtocol: 'tcp',
        },
      ],
    ]) as RTCStatsReport;
    const getStats = vi.fn().mockResolvedValueOnce(partial).mockResolvedValueOnce(complete);
    const pc = { getStats } as unknown as RTCPeerConnection;
    const result = selectedPair(pc, undefined, true);
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toMatchObject({
      source: 'selected-flag',
      pair: { localRelayProtocol: 'tcp' },
    });
    expect(getStats).toHaveBeenCalledTimes(2);
  });
});
