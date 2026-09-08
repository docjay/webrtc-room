import type { ApiClient, Credentials, IssuedAttempt } from './api.js';
import { normalizeRtcIceCandidate, type CandidateEvidence } from '../shared/normalization.js';
import { sanitizeIceConfig, type IceConfig, type Profile } from '../shared/domain.js';

export type ProbeResult = {
  outcome: 'success' | 'failure' | 'timeout' | 'cancelled';
  elapsedMs: number;
  candidates: CandidateEvidence[];
};
export type ProbeIceOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  rtcFactory?: (configuration: RTCConfiguration) => RTCPeerConnection;
  now?: () => number;
  setTimeout?: (handler: () => void, ms: number) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof globalThis.setTimeout>) => void;
};
export type ProbeTerminal = {
  outcome: 'pass' | 'inconclusive' | 'timeout' | 'unsupported' | 'cancelled' | 'failure';
  detail: string;
  elapsedMs: number;
  selected?: string;
  channel?: RTCDataChannel;
  close: () => void;
};
export const PAIRED_PROBE_DEADLINE_MS = 30_000;
export function nonOverlapping<T>(work: () => Promise<T>) {
  let running = false;
  return async (): Promise<T | undefined> => {
    if (running) return undefined;
    running = true;
    try {
      return await work();
    } finally {
      running = false;
    }
  };
}
export async function probeIce(
  server: RTCIceServer | string | undefined,
  options: ProbeIceOptions | number = {},
): Promise<ProbeResult> {
  const resolvedOptions = typeof options === 'number' ? { timeoutMs: options } : options;
  const timeoutMs = resolvedOptions.timeoutMs ?? 15_000;
  const url =
    server === undefined ? 'local' : typeof server === 'string' ? server : String(server.urls);
  const expectedType = url.startsWith('turn')
    ? 'relay'
    : url.startsWith('stun:')
      ? 'srflx'
      : undefined;
  const now = resolvedOptions.now ?? (() => performance.now());
  const setTimer =
    resolvedOptions.setTimeout ?? ((handler, ms) => globalThis.setTimeout(handler, ms));
  const clearTimer = resolvedOptions.clearTimeout ?? ((timer) => globalThis.clearTimeout(timer));
  const started = now();
  const candidates: CandidateEvidence[] = [];
  let pc: RTCPeerConnection | undefined;
  try {
    try {
      pc = (
        resolvedOptions.rtcFactory ?? ((configuration) => new RTCPeerConnection(configuration))
      )({
        iceServers:
          server === undefined ? [] : [typeof server === 'string' ? { urls: server } : server],
        ...(expectedType === 'relay' ? { iceTransportPolicy: 'relay' } : {}),
      });
    } catch {
      return { outcome: 'failure', elapsedMs: Math.round(now() - started), candidates };
    }
    const connection = pc;
    const outcome = await new Promise<ProbeResult['outcome']>((resolve) => {
      let settled = false;
      const settle = (value: ProbeResult['outcome']) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        resolvedOptions.signal?.removeEventListener('abort', cancelled);
        resolve(value);
      };
      const timer = setTimer(() => settle('timeout'), timeoutMs);
      const cancelled = () => settle('cancelled');
      if (resolvedOptions.signal?.aborted) {
        cancelled();
        return;
      }
      resolvedOptions.signal?.addEventListener('abort', cancelled, { once: true });
      connection.onicecandidate = ({ candidate }) => {
        if (candidate) {
          const evidence = normalizeRtcIceCandidate(candidate);
          candidates.push(evidence);
          if (
            (expectedType && evidence.type === expectedType) ||
            (!expectedType && candidates.length)
          )
            settle('success');
        } else {
          settle(
            expectedType
              ? candidates.some((value) => value.type === expectedType)
                ? 'success'
                : 'failure'
              : candidates.length > 0
                ? 'success'
                : 'failure',
          );
        }
      };
      connection.createDataChannel('preflight');
      void connection
        .createOffer()
        .then((offer) => connection.setLocalDescription(offer))
        .catch(() => {
          settle('failure');
        });
    });
    return { outcome, elapsedMs: Math.round(now() - started), candidates };
  } finally {
    pc?.close();
  }
}

export function requestedServers(
  profile: Profile,
  mine: 'a' | 'b',
  config: IceConfig,
): RTCConfiguration {
  const requested = mine === 'a' ? profile.a : profile.b;
  if (requested === 'direct-udp' || requested === 'direct-tcp') return { iceServers: [] };
  const endpoint = sanitizeIceConfig(config).find((value) => value.id === requested);
  if (!endpoint) return { iceServers: [] };
  const url = endpoint.urls[0]!;
  const source = config.iceServers.find((entry) =>
    (typeof entry.urls === 'string' ? [entry.urls] : entry.urls).includes(url),
  );
  const server: RTCIceServer = {
    urls: url,
    ...(source?.username ? { username: source.username } : {}),
    ...(source?.credential ? { credential: source.credential } : {}),
  };
  return {
    iceServers: [server],
    ...(endpoint.kind === 'turn' ? { iceTransportPolicy: 'relay' } : {}),
  };
}

export function candidateMatchesProfile(
  profile: Profile,
  mine: 'a' | 'b',
  candidate: Pick<RTCIceCandidate, 'type' | 'protocol'>,
) {
  const requested = mine === 'a' ? profile.a : profile.b;
  if (requested === 'direct-udp') return candidate.type === 'host' && candidate.protocol === 'udp';
  if (requested === 'direct-tcp') return candidate.type === 'host' && candidate.protocol === 'tcp';
  if (requested.startsWith('stun-'))
    return candidate.type === 'srflx' && candidate.protocol === 'udp';
  if (requested.startsWith('turn-')) return candidate.type === 'relay';
  return false;
}

type PairEvidence = {
  localType: string;
  remoteType: string;
  localProtocol: string;
  remoteProtocol: string;
  localRelayProtocol: string;
  remoteRelayProtocol: string;
};
async function selectedPair(pc: RTCPeerConnection): Promise<PairEvidence | undefined> {
  // Candidate-pair stats can appear shortly after a channel opens. Sampling
  // avoids one peer discarding an otherwise matching connection prematurely.
  for (let sample = 0; sample < 10; sample++) {
    const stats = await pc.getStats();
    for (const raw of stats.values()) {
      const report = raw as unknown as Record<string, unknown>;
      if (
        report.type === 'candidate-pair' &&
        report.nominated === true &&
        (report.selected === true || report.state === 'succeeded')
      ) {
        const local =
          typeof report.localCandidateId === 'string'
            ? (stats.get(report.localCandidateId) as unknown as Record<string, unknown> | undefined)
            : undefined;
        const remote =
          typeof report.remoteCandidateId === 'string'
            ? (stats.get(report.remoteCandidateId) as unknown as
                Record<string, unknown> | undefined)
            : undefined;
        return {
          localType: typeof local?.candidateType === 'string' ? local.candidateType : 'unavailable',
          remoteType:
            typeof remote?.candidateType === 'string' ? remote.candidateType : 'unavailable',
          localProtocol: typeof local?.protocol === 'string' ? local.protocol : 'unavailable',
          remoteProtocol: typeof remote?.protocol === 'string' ? remote.protocol : 'unavailable',
          localRelayProtocol:
            typeof local?.relayProtocol === 'string' ? local.relayProtocol : 'unavailable',
          remoteRelayProtocol:
            typeof remote?.relayProtocol === 'string' ? remote.relayProtocol : 'unavailable',
        };
      }
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
  }
  return undefined;
}
function candidatePolicy(profile: Profile, selected: PairEvidence | undefined, host: boolean) {
  if (!selected) return 'selected pair stats unavailable';
  if (profile.a === 'direct-tcp' || profile.b === 'direct-tcp')
    return 'browser cannot force ICE-TCP or a specific pair';
  const requested = host ? [profile.a, profile.b] : [profile.b, profile.a];
  const types = [selected.localType, selected.remoteType];
  const protocols = [selected.localProtocol, selected.remoteProtocol];
  const relayProtocols = [selected.localRelayProtocol, selected.remoteRelayProtocol];
  const relayRequested = requested.map((endpoint) => endpoint.startsWith('turn-'));
  for (let index = 0; index < 2; index++) {
    if (!relayRequested[index]) continue;
    const transport = requested[index]!.split('-')[1];
    if (types[index] !== 'relay') return 'selected pair did not prove requested relay on this side';
    if (relayProtocols[index] === 'unavailable')
      return 'selected pair relay protocol evidence unavailable';
    if (relayProtocols[index] !== (transport === 'tls' ? 'tcp' : transport))
      return 'selected pair relay protocol did not match requested endpoint';
  }
  if (!relayRequested.some(Boolean) && types.includes('relay'))
    return 'selected pair did not prove direct path';
  const stunRequested = requested.map((endpoint) => endpoint.startsWith('stun-'));
  if (
    requested.some(
      (endpoint, index) =>
        (endpoint === 'direct-udp' || stunRequested[index]) && protocols[index] !== 'udp',
    )
  )
    return 'selected pair protocol did not prove requested direct UDP path';
  for (let index = 0; index < stunRequested.length; index++) {
    if (!stunRequested[index] || types[index] === 'srflx' || types[index] === 'prflx') continue;
    return types[index] === 'host'
      ? 'browser selected a local host candidate on the STUN-requesting side; standard APIs cannot force a mapped candidate'
      : 'selected pair did not expose the requested STUN mapped-candidate evidence';
  }
  return undefined;
}
function describePair(pair: PairEvidence) {
  return `${pair.localType}/${pair.localProtocol}/${pair.localRelayProtocol} → ${pair.remoteType}/${pair.remoteProtocol}/${pair.remoteRelayProtocol}`;
}
export async function runPairedProbe(args: {
  api: ApiClient;
  credentials: Credentials;
  attempt: IssuedAttempt;
  profile: Profile;
  probeId: string;
  peerId: string;
  host: boolean;
  config: IceConfig;
  cancelled: () => boolean;
}): Promise<ProbeTerminal> {
  const { api, credentials, attempt, profile, probeId, peerId, host, config, cancelled } = args;
  const start = performance.now();
  if (profile.a === 'direct-tcp' || profile.b === 'direct-tcp')
    return {
      outcome: 'unsupported',
      detail: 'Standard WebRTC does not expose candidate-pair or ICE-TCP forcing.',
      elapsedMs: 0,
      close: () => undefined,
    };
  const pc = new RTCPeerConnection(requestedServers(profile, host ? 'a' : 'b', config));
  let cursor = 0,
    remoteChannel: RTCDataChannel | undefined,
    channel: RTCDataChannel | undefined,
    done = false,
    remoteDescriptionSet = false,
    pollFailure: Error | undefined;
  let rejectOpened: ((error: Error) => void) | undefined;
  const pendingCandidates: RTCIceCandidateInit[] = [];
  const close = () => {
    done = true;
    channel?.close();
    remoteChannel?.close();
    pc.close();
  };
  const transmit = (type: 'offer' | 'answer' | 'candidate' | 'bye', payload: string) =>
    api.sendSignal(credentials, attempt, probeId, peerId, { type, payload });
  pc.onicecandidate = ({ candidate }) => {
    if (candidate && candidateMatchesProfile(profile, host ? 'a' : 'b', candidate))
      void transmit('candidate', JSON.stringify(candidate.toJSON())).catch((error: unknown) => {
        pollFailure = error instanceof Error ? error : new Error('candidate signaling failed');
        rejectOpened?.(pollFailure);
        close();
      });
  };
  const opened = new Promise<RTCDataChannel>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('data channel deadline')),
      PAIRED_PROBE_DEADLINE_MS,
    );
    rejectOpened = (error) => {
      window.clearTimeout(timer);
      reject(error);
    };
    const activateChannel = (value: RTCDataChannel) => {
      channel = value;
      value.onopen = () => {
        clearTimeout(timer);
        rejectOpened = undefined;
        resolve(value);
      };
      value.onerror = () => {
        rejectOpened?.(new Error('data channel error'));
      };
    };
    if (host) activateChannel(pc.createDataChannel('matrix', { ordered: true }));
    pc.ondatachannel = ({ channel: incoming }) => {
      remoteChannel = incoming;
      activateChannel(incoming);
    };
  });
  const pollSignals = nonOverlapping(async () => {
    if (done || cancelled() || pollFailure) return;
    try {
      const response = await api.pollSignals(credentials, attempt, probeId, cursor);
      for (const signal of response.signals) {
        cursor = signal.id;
        const parsed: unknown = JSON.parse(signal.body);
        if (!parsed || typeof parsed !== 'object') continue;
        const message = parsed as { type?: unknown; payload?: unknown };
        if (typeof message.type !== 'string' || typeof message.payload !== 'string') continue;
        if (message.type === 'offer') {
          await pc.setRemoteDescription(JSON.parse(message.payload) as RTCSessionDescriptionInit);
          remoteDescriptionSet = true;
          for (const candidate of pendingCandidates) await pc.addIceCandidate(candidate);
          pendingCandidates.length = 0;
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await transmit('answer', JSON.stringify(answer));
        } else if (message.type === 'answer') {
          await pc.setRemoteDescription(JSON.parse(message.payload) as RTCSessionDescriptionInit);
          remoteDescriptionSet = true;
          for (const candidate of pendingCandidates) await pc.addIceCandidate(candidate);
          pendingCandidates.length = 0;
        } else if (message.type === 'candidate') {
          const candidate = JSON.parse(message.payload) as RTCIceCandidateInit;
          if (remoteDescriptionSet) await pc.addIceCandidate(candidate);
          else pendingCandidates.push(candidate);
        }
      }
    } catch (error) {
      pollFailure = error instanceof Error ? error : new Error('signaling poll failed');
      rejectOpened?.(pollFailure);
      close();
    }
  });
  const poll = window.setInterval(() => void pollSignals(), 150);
  try {
    if (host) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await transmit('offer', JSON.stringify(offer));
    }
    const active = await opened;
    if (pollFailure) throw pollFailure;
    const remoteVerdict = new Promise<'pass' | 'inconclusive' | 'timeout'>((resolve) => {
      const timer = window.setTimeout(() => {
        active.removeEventListener('message', receiveVerdict);
        resolve('timeout');
      }, 3_000);
      const receiveVerdict = ({ data }: MessageEvent) => {
        if (data !== 'probe-verdict:pass' && data !== 'probe-verdict:inconclusive') return;
        window.clearTimeout(timer);
        active.removeEventListener('message', receiveVerdict);
        resolve(data === 'probe-verdict:pass' ? 'pass' : 'inconclusive');
      };
      active.addEventListener('message', receiveVerdict);
    });
    const ping = new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), 3_000);
      active.onmessage = ({ data }) => {
        if (data === 'ping') active.send('pong');
        if (data === 'pong') {
          clearTimeout(timer);
          resolve(true);
        }
      };
      active.send('ping');
    });
    const verified = await ping;
    const selected = await selectedPair(pc);
    const policy = candidatePolicy(profile, selected, host);
    const localPass = verified && !policy;
    active.send(`probe-verdict:${localPass ? 'pass' : 'inconclusive'}`);
    const peerVerdict = await remoteVerdict;
    if (!verified)
      return {
        outcome: 'inconclusive',
        detail: 'data channel opened but bidirectional application ping timed out',
        elapsedMs: performance.now() - start,
        ...(selected ? { selected: describePair(selected) } : {}),
        close,
      };
    if (policy)
      return {
        outcome: 'inconclusive',
        detail: policy,
        elapsedMs: performance.now() - start,
        ...(selected ? { selected: describePair(selected) } : {}),
        close,
      };
    if (peerVerdict !== 'pass')
      return {
        outcome: 'inconclusive',
        detail:
          peerVerdict === 'timeout'
            ? 'peer path-verdict confirmation timed out'
            : 'peer did not confirm the requested selected-pair evidence',
        elapsedMs: performance.now() - start,
        ...(selected ? { selected: describePair(selected) } : {}),
        close,
      };
    return {
      outcome: 'pass',
      detail: 'selected pair and bidirectional application ping verified',
      elapsedMs: performance.now() - start,
      ...(selected ? { selected: describePair(selected) } : {}),
      channel: active,
      close,
    };
  } catch (error) {
    return {
      outcome: cancelled()
        ? 'cancelled'
        : performance.now() - start >= PAIRED_PROBE_DEADLINE_MS - 500
          ? 'timeout'
          : 'failure',
      detail: error instanceof Error ? error.message : 'negotiation failed',
      elapsedMs: performance.now() - start,
      close,
    };
  } finally {
    window.clearInterval(poll);
    if (!channel || channel.readyState !== 'open') close();
  }
}
