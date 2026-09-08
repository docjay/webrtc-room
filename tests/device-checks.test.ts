import { describe, expect, it, vi } from 'vitest';
import { DeviceCheckController } from '../src/client/device-checks.js';
import { probeIce } from '../src/client/webrtc.js';
import { iceConfigSchema } from '../src/shared/domain.js';
import { normalizeCandidateStats, normalizeRtcIceCandidate } from '../src/shared/normalization.js';

type Candidate = { type: string; protocol?: string; address?: string };

function rtcFactory(candidates: Candidate[] = [], configurations: RTCConfiguration[] = []) {
  return (configuration: RTCConfiguration) => {
    configurations.push(configuration);
    let handler: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
    const pc = {
      set onicecandidate(value: ((event: RTCPeerConnectionIceEvent) => void) | null) {
        handler = value;
      },
      createDataChannel: vi.fn(),
      createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: '' }),
      setLocalDescription: vi.fn().mockImplementation(() => {
        for (const candidate of candidates)
          handler?.({ candidate } as unknown as RTCPeerConnectionIceEvent);
        handler?.({ candidate: null } as unknown as RTCPeerConnectionIceEvent);
        return Promise.resolve();
      }),
      close: vi.fn(),
    };
    return pc as unknown as RTCPeerConnection;
  };
}

const config = iceConfigSchema.parse({
  iceServers: [
    { urls: 'stun:stun.example:3478' },
    {
      urls: 'turn:relay.example:3478?transport=udp',
      username: 'user',
      credential: 'very-secret-value',
    },
  ],
});

describe('device checks', () => {
  it('requires srflx/relay evidence and confines TURN credentials to the RTC constructor', async () => {
    const configurations: RTCConfiguration[] = [];
    const factory = rtcFactory(
      [
        { type: 'host', protocol: 'udp', address: '192.0.2.1' },
        { type: 'srflx', protocol: 'udp', address: '198.51.100.1' },
        { type: 'relay', protocol: 'udp', address: '203.0.113.1' },
      ],
      configurations,
    );
    const controller = new DeviceCheckController({
      checkSignaling: () => Promise.resolve(),
      environment: {
        secureContext: true,
        hasPeerConnection: true,
        hasDataChannel: true,
        hasRuntime: true,
        rtcFactory: factory,
      },
    });

    const snapshot = await controller.start({
      configuration: config,
      configurationVersion: 'version-one',
    });

    expect(snapshot.ready).toBe(true);
    expect(snapshot.results.map((result) => result.outcome)).toEqual(
      expect.arrayContaining(['pass']),
    );
    expect(
      snapshot.results.find((result) => result.id.startsWith('stun-'))?.candidateTypes,
    ).toContain('srflx');
    expect(
      snapshot.results.find((result) => result.id.startsWith('turn-') && result.candidateTypes)
        ?.candidateTypes,
    ).toContain('relay');
    expect(snapshot.results.find((result) => result.id === 'turn-relay-isolation')).toMatchObject({
      outcome: 'pass',
    });
    const directTcp = snapshot.results.find((result) => result.id === 'direct-ice-tcp-isolation');
    expect(directTcp?.outcome).toBe('unsupported');
    expect(directTcp?.detail).toMatch(/not direct TCP-only selection/i);
    const turn = configurations.find(
      (value) => value.iceTransportPolicy === 'relay' && value.iceServers?.[0]?.urls !== undefined,
    );
    expect(turn?.iceServers?.[0]).toMatchObject({
      urls: 'turn:relay.example:3478?transport=udp',
      username: 'user',
      credential: 'very-secret-value',
    });
    expect(JSON.stringify(snapshot)).not.toContain('very-secret-value');
  });

  it('does not pass STUN from host-only gathering and reports cancellation and stale starts safely', async () => {
    const factory = rtcFactory([{ type: 'host', protocol: 'udp', address: '192.0.2.1' }]);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    const controller = new DeviceCheckController({
      checkSignaling: () => pending,
      environment: {
        secureContext: true,
        hasPeerConnection: true,
        hasDataChannel: true,
        hasRuntime: true,
        rtcFactory: factory,
      },
    });
    const first = controller.start({ configuration: config, configurationVersion: 'old' });
    const second = controller.start({ configuration: config, configurationVersion: 'new' });
    release();
    await first;
    const snapshot = await second;

    expect(snapshot.configurationVersion).toBe('new');
    expect(snapshot.ready).toBe(true);
    expect(snapshot.results.find((result) => result.id.startsWith('stun-'))?.outcome).toBe(
      'failure',
    );
  });

  it('reports WebRTC support separately from an insecure page origin', async () => {
    const controller = new DeviceCheckController({
      checkSignaling: () => Promise.resolve(),
      environment: {
        secureContext: false,
        hasPeerConnection: true,
        hasDataChannel: true,
        hasRuntime: true,
        rtcFactory: () => {
          throw new Error('RTC checks must not run before HTTPS is available');
        },
      },
    });

    const snapshot = await controller.start({
      configuration: config,
      configurationVersion: 'insecure-origin',
    });
    const browser = snapshot.results.find((result) => result.id === 'browser');
    const secureContext = snapshot.results.find((result) => result.id === 'secure-context');

    expect(browser?.outcome).toBe('pass');
    expect(browser?.detail).toMatch(/required WebRTC APIs/i);
    expect(secureContext?.outcome).toBe('failure');
    expect(secureContext?.detail).toMatch(/require HTTPS/i);
    expect(snapshot.ready).toBe(false);
    expect(snapshot.blockingPrerequisites[0]).toMatch(/browser supports WebRTC.*HTTPS/i);
  });

  it('converts synchronous construction errors and timeouts into terminal outcomes', async () => {
    const constructionFailure = await probeIce('stun:stun.example:3478', {
      rtcFactory: () => {
        throw new Error('constructor failure');
      },
    });
    expect(constructionFailure.outcome).toBe('failure');

    const neverCompletes = () =>
      ({
        createDataChannel: vi.fn(),
        createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: '' }),
        setLocalDescription: vi.fn(),
        close: vi.fn(),
      }) as unknown as RTCPeerConnection;
    const timeout = await probeIce('stun:stun.example:3478', {
      rtcFactory: neverCompletes,
      timeoutMs: 1,
    });
    expect(timeout.outcome).toBe('timeout');
  });

  it('normalizes browser candidates and stats records through separate faithful inputs', () => {
    expect(
      normalizeRtcIceCandidate({ type: 'srflx', protocol: 'udp', address: 'host.local' }),
    ).toMatchObject({ type: 'srflx', addressFamily: 'mdns' });
    expect(normalizeCandidateStats({ candidateType: 'relay', protocol: 'tcp' })).toMatchObject({
      type: 'relay',
      protocol: 'tcp',
      addressFamily: 'unavailable',
    });
  });
});
