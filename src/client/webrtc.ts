import type { ApiClient, Credentials, IssuedAttempt } from './api.js';
import { PairedRtcDiagnostics, type DiagnosticCallback } from './rtc-diagnostics.js';
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

export type PairEvidence = {
  localType: string;
  remoteType: string;
  localProtocol: string;
  remoteProtocol: string;
  localRelayProtocol: string;
  remoteRelayProtocol: string;
};
async function selectedPair(
  pc: RTCPeerConnection,
  diagnostics?: PairedRtcDiagnostics,
): Promise<PairEvidence | undefined> {
  // Candidate-pair stats can appear shortly after a channel opens. Sampling
  // avoids one peer discarding an otherwise matching connection prematurely.
  for (let sample = 0; sample < 10; sample++) {
    let stats: RTCStatsReport;
    try {
      stats = await pc.getStats();
    } catch (error) {
      diagnostics?.statsUnavailable(error);
      return undefined;
    }
    diagnostics?.reportStats(stats);
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
export function candidatePolicy(
  profile: Profile,
  selected: PairEvidence | undefined,
  host: boolean,
) {
  if (!selected) return 'selected pair stats unavailable';
  if (profile.a === 'direct-tcp' || profile.b === 'direct-tcp')
    return 'browser cannot force ICE-TCP or a specific pair';
  const requested = host ? [profile.a, profile.b] : [profile.b, profile.a];
  const types = [selected.localType, selected.remoteType];
  const protocols = [selected.localProtocol, selected.remoteProtocol];
  const relayRequested = requested.map((endpoint) => endpoint.startsWith('turn-'));
  for (let index = 0; index < 2; index++) {
    if (!relayRequested[index]) continue;
    const transport = requested[index]!.split('-')[1];
    if (types[index] !== 'relay') return 'selected pair did not prove requested relay on this side';
    // The remote relay protocol is not exposed by all browsers. The remote
    // peer validates its own local relay protocol before confirming its verdict.
    if (index === 1) continue;
    if (selected.localRelayProtocol === 'unavailable')
      return 'selected pair relay protocol evidence unavailable';
    if (selected.localRelayProtocol !== transport)
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
  pairId: string;
  probeId: string;
  peerId: string;
  host: boolean;
  config: IceConfig;
  cancelled: () => boolean;
  signal?: AbortSignal;
  deadlineMs?: number;
  onDiagnostic?: DiagnosticCallback;
}): Promise<ProbeTerminal> {
  const {
    api,
    credentials,
    attempt,
    profile,
    pairId,
    probeId,
    peerId,
    host,
    config,
    cancelled,
    signal,
    deadlineMs = PAIRED_PROBE_DEADLINE_MS,
    onDiagnostic,
  } = args;
  const start = performance.now();
  const diagnostics = new PairedRtcDiagnostics(host ? 'A' : 'B', profile.id, onDiagnostic);
  if (profile.a === 'direct-tcp' || profile.b === 'direct-tcp') {
    diagnostics.emit('summary', 'info', 'probe terminal=unsupported; browser cannot force ICE-TCP');
    return {
      outcome: 'unsupported',
      detail: 'Standard WebRTC does not expose candidate-pair or ICE-TCP forcing.',
      elapsedMs: 0,
      close: () => undefined,
    };
  }
  const pc = new RTCPeerConnection(requestedServers(profile, host ? 'a' : 'b', config));
  let cursor = 0,
    remoteChannel: RTCDataChannel | undefined,
    channel: RTCDataChannel | undefined,
    done = false,
    remoteDescriptionSet = false,
    pollFailure: Error | undefined;
  let rejectOpened: ((error: Error) => void) | undefined;
  let receivePong: (() => void) | undefined;
  let receivePeerVerdict: ((value: 'pass' | 'inconclusive') => void) | undefined;
  let bufferedPeerVerdict: 'pass' | 'inconclusive' | undefined;
  let openTimer: number | undefined;
  let terminalRecorded = false;
  const pendingCandidates: RTCIceCandidateInit[] = [];
  const detachDiagnostics = () => {
    pc.onicecandidate = null;
    pc.onicecandidateerror = null;
    pc.onicegatheringstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.onsignalingstatechange = null;
  };
  const close = () => {
    done = true;
    if (openTimer !== undefined) window.clearTimeout(openTimer);
    detachDiagnostics();
    if (channel) {
      channel.onopen = null;
      channel.onmessage = null;
      channel.onerror = null;
    }
    channel?.close();
    remoteChannel?.close();
    pc.close();
  };
  const terminal = (outcome: ProbeTerminal['outcome']) => {
    if (terminalRecorded) return;
    terminalRecorded = true;
    diagnostics.terminal(outcome, pc);
  };
  const finish = (result: ProbeTerminal) => {
    terminal(result.outcome);
    return result;
  };
  const transmit = (type: 'offer' | 'answer' | 'candidate' | 'bye', payload: string) =>
    api.sendSignal(credentials, attempt, probeId, pairId, peerId, { type, payload }, signal);
  pc.onicegatheringstatechange = () => diagnostics.state('ICE gathering', pc.iceGatheringState);
  pc.oniceconnectionstatechange = () => diagnostics.state('ICE connection', pc.iceConnectionState);
  pc.onsignalingstatechange = () => diagnostics.state('signaling', pc.signalingState);
  pc.onicecandidateerror = (event) => diagnostics.candidateError(event.errorText, event.errorCode);
  pc.onicecandidate = ({ candidate }) => {
    if (!candidate) {
      diagnostics.emit('candidate', 'info', 'local ICE gathering complete');
      return;
    }
    diagnostics.candidate('local', 'gathered', candidate);
    if (!candidateMatchesProfile(profile, host ? 'a' : 'b', candidate)) {
      diagnostics.candidate('local', 'filtered', candidate);
      return;
    }
    void transmit('candidate', JSON.stringify(candidate.toJSON()))
      .then(() => diagnostics.candidate('local', 'signaled', candidate))
      .catch((error: unknown) => {
        pollFailure = error instanceof Error ? error : new Error('candidate signaling failed');
        diagnostics.emit('failure', 'failure', 'candidate signaling failed');
        rejectOpened?.(pollFailure);
        terminal('failure');
        close();
      });
  };
  const opened = new Promise<RTCDataChannel>((resolve, reject) => {
    openTimer = window.setTimeout(() => reject(new Error('data channel deadline')), deadlineMs);
    rejectOpened = (error) => {
      if (openTimer !== undefined) window.clearTimeout(openTimer);
      reject(error);
    };
    const activateChannel = (value: RTCDataChannel) => {
      channel = value;
      diagnostics.emit('operation', 'info', 'data channel received');
      value.onmessage = ({ data }) => {
        if (data === 'ping') {
          diagnostics.emit('operation', 'info', 'application ping received; pong sent');
          value.send('pong');
          return;
        }
        if (data === 'pong') {
          receivePong?.();
          return;
        }
        if (data === 'probe-verdict:pass' || data === 'probe-verdict:inconclusive') {
          const verdict = data === 'probe-verdict:pass' ? 'pass' : 'inconclusive';
          diagnostics.emit('operation', 'info', `peer verdict received=${verdict}`);
          if (receivePeerVerdict) receivePeerVerdict(verdict);
          else bufferedPeerVerdict = verdict;
        }
      };
      value.onopen = () => {
        if (openTimer !== undefined) clearTimeout(openTimer);
        rejectOpened = undefined;
        diagnostics.emit('operation', 'success', 'data channel open');
        resolve(value);
      };
      value.onerror = () => {
        diagnostics.emit('failure', 'failure', 'data channel error');
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
      const response = await api.pollSignals(credentials, attempt, probeId, pairId, cursor, signal);
      for (const signal of response.signals) {
        cursor = signal.id;
        const parsed: unknown = JSON.parse(signal.body);
        if (!parsed || typeof parsed !== 'object') continue;
        const message = parsed as { type?: unknown; payload?: unknown };
        if (typeof message.type !== 'string' || typeof message.payload !== 'string') continue;
        if (message.type === 'offer') {
          const description = JSON.parse(message.payload) as RTCSessionDescriptionInit;
          diagnostics.embeddedCandidates(
            'offer',
            typeof description.sdp === 'string' ? description.sdp : '',
          );
          await pc.setRemoteDescription(description);
          remoteDescriptionSet = true;
          diagnostics.state('remote offer', 'applied');
          for (const candidate of pendingCandidates) {
            try {
              await pc.addIceCandidate(candidate);
              diagnostics.candidate('remote', 'accepted', new RTCIceCandidate(candidate));
            } catch {
              diagnostics.candidate('remote', 'rejected', new RTCIceCandidate(candidate));
              throw new Error('remote candidate rejected');
            }
          }
          pendingCandidates.length = 0;
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await transmit('answer', JSON.stringify(answer));
        } else if (message.type === 'answer') {
          const description = JSON.parse(message.payload) as RTCSessionDescriptionInit;
          diagnostics.embeddedCandidates(
            'answer',
            typeof description.sdp === 'string' ? description.sdp : '',
          );
          await pc.setRemoteDescription(description);
          remoteDescriptionSet = true;
          diagnostics.state('remote answer', 'applied');
          for (const candidate of pendingCandidates) {
            try {
              await pc.addIceCandidate(candidate);
              diagnostics.candidate('remote', 'accepted', new RTCIceCandidate(candidate));
            } catch {
              diagnostics.candidate('remote', 'rejected', new RTCIceCandidate(candidate));
              throw new Error('remote candidate rejected');
            }
          }
          pendingCandidates.length = 0;
        } else if (message.type === 'candidate') {
          const candidate = JSON.parse(message.payload) as RTCIceCandidateInit;
          let safeCandidate: RTCIceCandidate;
          try {
            safeCandidate = new RTCIceCandidate(candidate);
          } catch {
            diagnostics.candidate('remote', 'rejected', {});
            throw new Error('remote candidate invalid');
          }
          diagnostics.candidate('remote', 'received', safeCandidate);
          if (remoteDescriptionSet) {
            try {
              await pc.addIceCandidate(candidate);
              diagnostics.candidate('remote', 'accepted', safeCandidate);
            } catch {
              diagnostics.candidate('remote', 'rejected', safeCandidate);
              throw new Error('remote candidate rejected');
            }
          } else {
            pendingCandidates.push(candidate);
            diagnostics.candidate('remote', 'queued', safeCandidate);
          }
        }
      }
    } catch {
      pollFailure = new Error('signaling poll failed');
      diagnostics.emit(
        'failure',
        'failure',
        'signaling poll or remote candidate application failed',
      );
      rejectOpened?.(pollFailure);
      terminal('failure');
      close();
    }
  });
  const poll = window.setInterval(() => void pollSignals(), 150);
  const interruptedOutcome = () =>
    signal?.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
      ? 'timeout'
      : 'cancelled';
  const abort = () => {
    rejectOpened?.(new DOMException('attempt cancelled', 'AbortError'));
    terminal(interruptedOutcome());
    close();
  };
  try {
    if (signal?.aborted || cancelled()) throw new DOMException('attempt cancelled', 'AbortError');
    signal?.addEventListener('abort', abort, { once: true });
    diagnostics.startStats(pc);
    if (host) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await transmit('offer', JSON.stringify(offer));
      diagnostics.emit('operation', 'success', 'local offer created and signaled');
    }
    const active = await opened;
    if (pollFailure) throw pollFailure;
    const remoteVerdict = new Promise<'pass' | 'inconclusive' | 'timeout'>((resolve) => {
      const timer = window.setTimeout(() => {
        receivePeerVerdict = undefined;
        resolve('timeout');
      }, 3_000);
      receivePeerVerdict = (verdict) => {
        window.clearTimeout(timer);
        receivePeerVerdict = undefined;
        resolve(verdict);
      };
      if (bufferedPeerVerdict) {
        const verdict = bufferedPeerVerdict;
        bufferedPeerVerdict = undefined;
        receivePeerVerdict(verdict);
      }
    });
    const ping = new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => {
        receivePong = undefined;
        resolve(false);
      }, 3_000);
      receivePong = () => {
        clearTimeout(timer);
        receivePong = undefined;
        diagnostics.emit('operation', 'success', 'application pong received');
        resolve(true);
      };
      diagnostics.emit('operation', 'start', 'application ping sent');
      active.send('ping');
    });
    const verified = await ping;
    const selected = await selectedPair(pc, diagnostics);
    const policy = candidatePolicy(profile, selected, host);
    const localPass = verified && !policy;
    active.send(`probe-verdict:${localPass ? 'pass' : 'inconclusive'}`);
    diagnostics.emit(
      'operation',
      'info',
      `local verdict sent=${localPass ? 'pass' : 'inconclusive'}`,
    );
    const peerVerdict = await remoteVerdict;
    if (!verified)
      return finish({
        outcome: 'inconclusive',
        detail: 'data channel opened but bidirectional application ping timed out',
        elapsedMs: performance.now() - start,
        ...(selected ? { selected: describePair(selected) } : {}),
        close,
      });
    if (policy)
      return finish({
        outcome: 'inconclusive',
        detail: policy,
        elapsedMs: performance.now() - start,
        ...(selected ? { selected: describePair(selected) } : {}),
        close,
      });
    if (peerVerdict !== 'pass')
      return finish({
        outcome: 'inconclusive',
        detail:
          peerVerdict === 'timeout'
            ? 'peer path-verdict confirmation timed out'
            : 'peer did not confirm the requested selected-pair evidence',
        elapsedMs: performance.now() - start,
        ...(selected ? { selected: describePair(selected) } : {}),
        close,
      });
    return finish({
      outcome: 'pass',
      detail: 'selected pair and bidirectional application ping verified',
      elapsedMs: performance.now() - start,
      ...(selected ? { selected: describePair(selected) } : {}),
      channel: active,
      close,
    });
  } catch {
    diagnostics.emit('failure', 'failure', 'probe negotiation or signaling failed');
    const outcome = signal?.aborted
      ? interruptedOutcome()
      : cancelled()
        ? 'cancelled'
        : performance.now() - start >= deadlineMs - 500
          ? 'timeout'
          : 'failure';
    return finish({
      outcome,
      detail: 'probe negotiation or signaling failed',
      elapsedMs: performance.now() - start,
      close,
    });
  } finally {
    window.clearInterval(poll);
    signal?.removeEventListener('abort', abort);
    detachDiagnostics();
    if (channel) {
      channel.onopen = null;
      channel.onmessage = null;
      channel.onerror = null;
    }
    pc.ondatachannel = null;
    diagnostics.stop();
    if (!channel || channel.readyState !== 'open') close();
  }
}
