import type { ApiClient, Credentials, IssuedAttempt } from './api.js';
import { PairedRtcDiagnostics, type DiagnosticCallback } from './rtc-diagnostics.js';
import { ProbeHandshake } from './probe-handshake.js';
import { normalizeRtcIceCandidate, type CandidateEvidence } from '../shared/normalization.js';
import { sanitizeIceConfig, type IceConfig, type Profile } from '../shared/domain.js';
import type { ConnectivityOutcome, ProtocolVerification } from '../shared/probe-assessment.js';

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
  /** Optional at the API boundary while every engine-created terminal populates it. */
  connectivity?: ConnectivityOutcome;
  /** Optional at the API boundary while every engine-created terminal populates it. */
  protocolVerification?: ProtocolVerification;
  detail: string;
  elapsedMs: number;
  selected?: string;
  channel?: RTCDataChannel;
  close: () => void;
};
export const PAIRED_PROBE_DEADLINE_MS = 30_000;

export type ProbeFailureEvidence = {
  requestedCandidateType?: 'srflx' | 'relay' | 'host';
  localRequestedCandidateDiscovered: boolean;
  remoteDescriptionApplied: boolean;
  remoteCandidatesAccepted: number;
  iceConnectionState: RTCIceConnectionState;
  channelOpened: boolean;
  signalingFailure?: 'http' | 'apply';
  interrupted?: 'cancelled' | 'deadline';
  timedOut: boolean;
};

export function classifyProbeFailure(evidence: ProbeFailureEvidence): string {
  if (evidence.interrupted === 'cancelled') return 'probe cancelled before completion';
  if (evidence.signalingFailure === 'http')
    return 'signaling HTTP request failed before probe completion';
  if (evidence.signalingFailure === 'apply')
    return 'remote offer, answer, or candidate application failed before probe completion';

  const beforeDeadline = evidence.timedOut || evidence.interrupted === 'deadline';
  if (!beforeDeadline) return 'probe ended before a verified channel result';
  if (!evidence.remoteDescriptionApplied)
    return 'waiting for remote offer/answer; no remote description was applied before the probe deadline';
  if (!evidence.localRequestedCandidateDiscovered) {
    if (evidence.requestedCandidateType === 'srflx')
      return 'No STUN mapped address was observed before the probe deadline';
    if (evidence.requestedCandidateType === 'relay')
      return 'No TURN relay candidate was observed before the probe deadline';
    if (evidence.requestedCandidateType === 'host')
      return 'No local host candidate was observed before the probe deadline';
  }
  if (!evidence.remoteCandidatesAccepted)
    return 'local candidate discovery completed, but no remote candidates were accepted before the probe deadline';
  if (evidence.iceConnectionState === 'connected' || evidence.iceConnectionState === 'completed')
    return evidence.channelOpened
      ? 'data channel opened, but application verification did not complete before the probe deadline'
      : 'ICE connected, but the data channel did not open before the probe deadline';
  if (evidence.requestedCandidateType === 'srflx')
    return `STUN address discovery succeeded; mapped-address connectivity timed out (ICE connection=${evidence.iceConnectionState})`;
  return `ICE connectivity timed out (ICE connection=${evidence.iceConnectionState})`;
}

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
export type SelectedPairEvidence = {
  pair?: PairEvidence;
  source: 'transport-link' | 'selected-flag' | 'nominated-fallback' | 'missing-linkage';
};

function pairEvidence(stats: RTCStatsReport, report: Record<string, unknown>): PairEvidence {
  const candidate = (id: unknown) =>
    typeof id === 'string'
      ? (stats.get(id) as unknown as Record<string, unknown> | undefined)
      : undefined;
  const local = candidate(report.localCandidateId);
  const remote = candidate(report.remoteCandidateId);
  return {
    localType: typeof local?.candidateType === 'string' ? local.candidateType : 'unavailable',
    remoteType: typeof remote?.candidateType === 'string' ? remote.candidateType : 'unavailable',
    localProtocol: typeof local?.protocol === 'string' ? local.protocol : 'unavailable',
    remoteProtocol: typeof remote?.protocol === 'string' ? remote.protocol : 'unavailable',
    localRelayProtocol:
      typeof local?.relayProtocol === 'string' ? local.relayProtocol : 'unavailable',
    remoteRelayProtocol:
      typeof remote?.relayProtocol === 'string' ? remote.relayProtocol : 'unavailable',
  };
}

/** Select only browser-linked or unambiguous succeeded+nominated pairs. */
export function extractSelectedPair(stats: RTCStatsReport): SelectedPairEvidence {
  const pairs = [...stats.entries()]
    .map(([key, raw]) => ({ raw: raw as Record<string, unknown>, key }))
    .filter(({ raw }) => raw.type === 'candidate-pair');
  const idOf = ({ raw, key }: (typeof pairs)[number]) =>
    typeof raw.id === 'string' ? raw.id : key;
  const transports = [...stats.values()]
    .map((raw) => raw as unknown as Record<string, unknown>)
    .filter((raw) => raw.type === 'transport' && typeof raw.selectedCandidatePairId === 'string');
  const transportIds = new Set(transports.map((transport) => transport.selectedCandidatePairId));
  if (transportIds.size > 1) return { source: 'missing-linkage' };
  if (transportIds.size === 1) {
    const selectedId = [...transportIds][0]!;
    const match = pairs.find(({ raw, key }) => idOf({ raw, key }) === selectedId);
    if (match) return { pair: pairEvidence(stats, match.raw), source: 'transport-link' };
    return { source: 'missing-linkage' };
  }
  const selected = pairs.filter(({ raw }) => raw.selected === true);
  if (selected.length === 1)
    return { pair: pairEvidence(stats, selected[0]!.raw), source: 'selected-flag' };
  if (selected.length > 1) return { source: 'missing-linkage' };
  const nominated = pairs.filter(({ raw }) => raw.nominated === true && raw.state === 'succeeded');
  if (nominated.length === 1)
    return { pair: pairEvidence(stats, nominated[0]!.raw), source: 'nominated-fallback' };
  return { source: 'missing-linkage' };
}

export async function selectedPair(
  pc: RTCPeerConnection,
  diagnostics?: PairedRtcDiagnostics,
  waitForLocalRelayDetails = false,
): Promise<SelectedPairEvidence> {
  // Candidate-pair stats can appear shortly after a channel opens. Sampling
  // avoids one peer discarding an otherwise matching connection prematurely.
  let incomplete: SelectedPairEvidence | undefined;
  for (let sample = 0; sample < 10; sample++) {
    let stats: RTCStatsReport;
    try {
      stats = await pc.getStats();
    } catch (error) {
      diagnostics?.statsUnavailable(error);
      return { source: 'missing-linkage' };
    }
    diagnostics?.reportStats(stats);
    const selected = extractSelectedPair(stats);
    if (selected.pair) {
      const localDetailsReady =
        selected.pair.localType !== 'unavailable' &&
        selected.pair.localRelayProtocol !== 'unavailable';
      if (!waitForLocalRelayDetails || localDetailsReady) {
        diagnostics?.selectedPairEvidence(selected.source);
        return selected;
      }
      incomplete = selected;
    }
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 100));
  }
  const result = incomplete ?? { source: 'missing-linkage' };
  diagnostics?.selectedPairEvidence(result.source);
  return result;
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
    if (types[index] !== 'relay') return 'selected pair did not prove requested relay on this side';
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

function requestedRelay(profile: Profile, host: boolean) {
  return (host ? profile.a : profile.b).startsWith('turn-');
}

export function relayConnectivityPolicy(
  profile: Profile,
  selected: PairEvidence | undefined,
  host: boolean,
  localRelayGathered: boolean,
  relayOnlyConfigured: boolean,
) {
  const requested = host ? [profile.a, profile.b] : [profile.b, profile.a];
  const localRequested = requested[0]!;
  if (!localRequested.startsWith('turn-')) {
    if (!selected) return 'selected pair stats unavailable';
    if (localRequested === 'direct-udp') {
      if (selected.localType !== 'host')
        return 'selected pair did not prove requested direct path on this side';
      return selected.localProtocol === 'udp'
        ? undefined
        : 'selected pair protocol did not prove requested direct UDP path';
    }
    if (localRequested.startsWith('stun-')) {
      if (selected.localProtocol !== 'udp')
        return 'selected pair protocol did not prove requested direct UDP path';
      return selected.localType === 'srflx' || selected.localType === 'prflx'
        ? undefined
        : selected.localType === 'host'
          ? 'browser selected a local host candidate on the STUN-requesting side; standard APIs cannot force a mapped candidate'
          : 'selected pair did not expose the requested STUN mapped-candidate evidence';
    }
    return candidatePolicy(profile, selected, host);
  }
  if (!relayOnlyConfigured) return 'relay-only ICE policy was not configured on this side';
  if (!selected)
    return !localRelayGathered
      ? 'no local TURN relay candidate was observed before application verification'
      : undefined;
  if (selected.localType === 'relay') return undefined;
  if (selected.localType === 'unavailable' && localRelayGathered) return undefined;
  return selected.localType === 'unavailable'
    ? 'no local TURN relay candidate was observed before application verification'
    : 'selected pair did not prove requested relay on this side';
}

export function localProtocolVerification(
  profile: Profile,
  selected: PairEvidence | undefined,
  host: boolean,
): ProtocolVerification {
  if (!requestedRelay(profile, host)) return 'not-applicable';
  if (!selected || selected.localType !== 'relay') return 'unavailable';
  const requested = (host ? profile.a : profile.b).split('-')[1];
  if (selected.localRelayProtocol === 'unavailable') return 'unavailable';
  return selected.localRelayProtocol === requested ? 'verified' : 'mismatch';
}

function assessmentForTerminal(
  outcome: ProbeTerminal['outcome'],
  relayRequested: boolean,
): Pick<ProbeTerminal, 'connectivity' | 'protocolVerification'> {
  return {
    connectivity:
      outcome === 'pass'
        ? 'pass'
        : outcome === 'failure'
          ? 'failure'
          : outcome === 'timeout'
            ? 'timeout'
            : 'unconfirmed',
    protocolVerification: relayRequested ? 'not-tested' : 'not-applicable',
  };
}
function describePair(pair: PairEvidence) {
  return `${pair.localType}/${pair.localProtocol}/${pair.localRelayProtocol} → ${pair.remoteType}/${pair.remoteProtocol}/${pair.remoteRelayProtocol}`;
}
function embeddedCandidateCount(description: RTCSessionDescriptionInit) {
  return typeof description.sdp === 'string'
    ? (description.sdp.match(/^a=candidate:/gm) ?? []).length
    : 0;
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
      ...assessmentForTerminal('unsupported', requestedRelay(profile, host)),
      detail: 'Standard WebRTC does not expose candidate-pair or ICE-TCP forcing.',
      elapsedMs: 0,
      close: () => undefined,
    };
  }
  let pc: RTCPeerConnection;
  const rtcConfiguration = requestedServers(profile, host ? 'a' : 'b', config);
  try {
    pc = new RTCPeerConnection(rtcConfiguration);
  } catch {
    diagnostics.emit('failure', 'failure', 'RTCPeerConnection setup failed before probe start');
    return {
      outcome: 'failure',
      ...assessmentForTerminal('failure', requestedRelay(profile, host)),
      detail: 'RTCPeerConnection setup failed before probe start',
      elapsedMs: performance.now() - start,
      close: () => undefined,
    };
  }
  let cursor = 0,
    remoteChannel: RTCDataChannel | undefined,
    channel: RTCDataChannel | undefined,
    done = false,
    remoteDescriptionSet = false,
    pollFailure: Error | undefined,
    signalingFailure: ProbeFailureEvidence['signalingFailure'],
    interrupted: ProbeFailureEvidence['interrupted'],
    localRequestedCandidateDiscovered = false,
    remoteCandidatesAccepted = 0,
    channelOpened = false;
  let observedIceConnectionState = pc.iceConnectionState;
  let rejectOpened: ((error: Error) => void) | undefined;
  let handshake: ProbeHandshake | undefined;
  let openTimer: number | undefined;
  let terminalRecorded = false;
  let capturedFailureEvidence: Omit<ProbeFailureEvidence, 'timedOut'> | undefined;
  const pendingCandidates: RTCIceCandidateInit[] = [];
  const detachDiagnostics = () => {
    pc.onicecandidate = null;
    pc.onicecandidateerror = null;
    pc.onicegatheringstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.onsignalingstatechange = null;
  };
  const close = () => {
    if (done) return;
    done = true;
    handshake?.dispose();
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
  const requestedProfile = host ? profile.a : profile.b;
  const requestedCandidateType = requestedProfile.startsWith('stun-')
    ? 'srflx'
    : requestedProfile.startsWith('turn-')
      ? 'relay'
      : requestedProfile.startsWith('direct-')
        ? 'host'
        : undefined;
  const captureFailureEvidence = (): Omit<ProbeFailureEvidence, 'timedOut'> => ({
    ...(requestedCandidateType ? { requestedCandidateType } : {}),
    localRequestedCandidateDiscovered,
    remoteDescriptionApplied: remoteDescriptionSet,
    remoteCandidatesAccepted,
    iceConnectionState: observedIceConnectionState,
    channelOpened,
    ...(signalingFailure ? { signalingFailure } : {}),
    ...(interrupted ? { interrupted } : {}),
  });
  const failureDetail = (outcome: ProbeTerminal['outcome']) =>
    classifyProbeFailure({
      ...(capturedFailureEvidence ?? captureFailureEvidence()),
      timedOut: outcome === 'timeout',
    });
  const finish = (
    result: Omit<ProbeTerminal, 'connectivity' | 'protocolVerification'> &
      Partial<Pick<ProbeTerminal, 'connectivity' | 'protocolVerification'>>,
  ): ProbeTerminal => {
    terminal(result.outcome);
    return {
      ...assessmentForTerminal(result.outcome, requestedRelay(profile, host)),
      ...result,
    };
  };
  const transmit = (type: 'offer' | 'answer' | 'candidate' | 'bye', payload: string) =>
    api.sendSignal(credentials, attempt, probeId, pairId, peerId, { type, payload }, signal);
  const fail = (stage: NonNullable<ProbeFailureEvidence['signalingFailure']>) => {
    if (done) return;
    signalingFailure = stage;
    pollFailure = new Error(
      stage === 'http' ? 'signaling request failed' : 'signaling application failed',
    );
    capturedFailureEvidence = captureFailureEvidence();
    diagnostics.emit('failure', 'failure', failureDetail('failure'));
    rejectOpened?.(pollFailure);
    terminal('failure');
    close();
  };
  pc.onicegatheringstatechange = () => diagnostics.state('ICE gathering', pc.iceGatheringState);
  pc.oniceconnectionstatechange = () => {
    observedIceConnectionState = pc.iceConnectionState;
    diagnostics.state('ICE connection', observedIceConnectionState);
  };
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
    localRequestedCandidateDiscovered = true;
    void transmit('candidate', JSON.stringify(candidate.toJSON()))
      .then(() => diagnostics.candidate('local', 'signaled', candidate))
      .catch(() => fail('http'));
  };
  const opened = new Promise<RTCDataChannel>((resolve, reject) => {
    openTimer = window.setTimeout(() => reject(new Error('data channel deadline')), deadlineMs);
    rejectOpened = (error) => {
      if (openTimer !== undefined) window.clearTimeout(openTimer);
      reject(error);
    };
    const activateChannel = (value: RTCDataChannel) => {
      if (channel === value) return;
      channel = value;
      diagnostics.emit('operation', 'info', 'data channel received');
      handshake = new ProbeHandshake(
        value,
        (message) => diagnostics.emit('operation', 'info', message),
        signal,
      );
      let openedOnce = false;
      const onOpen = () => {
        if (openedOnce || done) return;
        openedOnce = true;
        channelOpened = true;
        if (openTimer !== undefined) clearTimeout(openTimer);
        rejectOpened = undefined;
        diagnostics.emit('operation', 'success', 'data channel open');
        resolve(value);
      };
      value.onopen = onOpen;
      value.onerror = () => {
        diagnostics.emit('failure', 'failure', 'data channel error');
        rejectOpened?.(new Error('data channel error'));
      };
      if (value.readyState === 'open') onOpen();
    };
    if (host) activateChannel(pc.createDataChannel('matrix', { ordered: true }));
    pc.ondatachannel = ({ channel: incoming }) => {
      remoteChannel = incoming;
      activateChannel(incoming);
    };
  });
  const pollSignals = nonOverlapping(async () => {
    if (done || cancelled() || signal?.aborted || pollFailure) return;
    let response: Awaited<ReturnType<ApiClient['pollSignals']>>;
    try {
      response = await api.pollSignals(credentials, attempt, probeId, pairId, cursor, signal);
    } catch {
      if (!done && !cancelled() && !signal?.aborted) fail('http');
      return;
    }
    try {
      for (const signal of response.signals) {
        cursor = signal.id;
        const parsed: unknown = JSON.parse(signal.body);
        if (!parsed || typeof parsed !== 'object') continue;
        const message = parsed as { type?: unknown; payload?: unknown };
        if (typeof message.type !== 'string' || typeof message.payload !== 'string') continue;
        if (message.type === 'offer') {
          const description = JSON.parse(message.payload) as RTCSessionDescriptionInit;
          await pc.setRemoteDescription(description);
          diagnostics.embeddedCandidates(
            'offer',
            typeof description.sdp === 'string' ? description.sdp : '',
          );
          remoteDescriptionSet = true;
          remoteCandidatesAccepted += embeddedCandidateCount(description);
          diagnostics.state('remote offer', 'applied');
          for (const candidate of pendingCandidates) {
            try {
              await pc.addIceCandidate(candidate);
              remoteCandidatesAccepted++;
              diagnostics.candidate('remote', 'accepted', new RTCIceCandidate(candidate));
            } catch {
              diagnostics.candidate('remote', 'rejected', new RTCIceCandidate(candidate));
              throw new Error('remote candidate rejected');
            }
          }
          pendingCandidates.length = 0;
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          try {
            await transmit('answer', JSON.stringify(answer));
          } catch {
            fail('http');
            return;
          }
        } else if (message.type === 'answer') {
          const description = JSON.parse(message.payload) as RTCSessionDescriptionInit;
          await pc.setRemoteDescription(description);
          diagnostics.embeddedCandidates(
            'answer',
            typeof description.sdp === 'string' ? description.sdp : '',
          );
          remoteDescriptionSet = true;
          remoteCandidatesAccepted += embeddedCandidateCount(description);
          diagnostics.state('remote answer', 'applied');
          for (const candidate of pendingCandidates) {
            try {
              await pc.addIceCandidate(candidate);
              remoteCandidatesAccepted++;
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
              remoteCandidatesAccepted++;
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
      if (!done && !cancelled() && !signal?.aborted) fail('apply');
    }
  });
  const poll = window.setInterval(() => void pollSignals(), 150);
  const interruptedOutcome = () =>
    signal?.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
      ? 'timeout'
      : 'cancelled';
  const abort = () => {
    interrupted = interruptedOutcome() === 'timeout' ? 'deadline' : 'cancelled';
    capturedFailureEvidence = captureFailureEvidence();
    diagnostics.emit('failure', 'failure', failureDetail(interruptedOutcome()));
    rejectOpened?.(new DOMException('attempt cancelled', 'AbortError'));
    terminal(interruptedOutcome());
    close();
  };
  try {
    if (signal?.aborted) {
      interrupted = interruptedOutcome() === 'timeout' ? 'deadline' : 'cancelled';
      throw new DOMException('attempt cancelled', 'AbortError');
    }
    if (cancelled()) {
      interrupted = 'cancelled';
      throw new DOMException('attempt cancelled', 'AbortError');
    }
    signal?.addEventListener('abort', abort, { once: true });
    diagnostics.startStats(pc);
    if (host) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      try {
        await transmit('offer', JSON.stringify(offer));
      } catch {
        if (!cancelled() && !signal?.aborted) fail('http');
        throw new Error('offer signaling failed');
      }
      diagnostics.emit('operation', 'success', 'local offer created and signaled');
    }
    const active = await opened;
    if (pollFailure) throw pollFailure;
    if (!handshake) throw new Error('probe handshake unavailable');
    const verified = await handshake.verify();
    if (pollFailure || signal?.aborted || cancelled())
      throw pollFailure ?? new DOMException('attempt cancelled', 'AbortError');
    const selection = await selectedPair(pc, diagnostics, requestedRelay(profile, host));
    const selected = selection.pair;
    if (pollFailure || signal?.aborted || cancelled())
      throw pollFailure ?? new DOMException('attempt cancelled', 'AbortError');
    const relayInvolved = profile.a.startsWith('turn-') || profile.b.startsWith('turn-');
    const policy = relayInvolved
      ? relayConnectivityPolicy(
          profile,
          selected,
          host,
          localRequestedCandidateDiscovered,
          (pc.getConfiguration?.().iceTransportPolicy ?? rtcConfiguration.iceTransportPolicy) ===
            'relay',
        )
      : candidatePolicy(profile, selected, host);
    const connectivityPass = verified && !policy;
    const peerVerdict = await handshake.confirm(connectivityPass, relayInvolved);
    if (pollFailure || signal?.aborted || cancelled())
      throw pollFailure ?? new DOMException('attempt cancelled', 'AbortError');
    if (!verified)
      return finish({
        outcome: relayInvolved ? 'timeout' : 'inconclusive',
        detail: 'data channel opened but bidirectional application ping timed out',
        elapsedMs: performance.now() - start,
        ...(selected ? { selected: describePair(selected) } : {}),
        close,
      });
    if (policy)
      return finish({
        outcome: relayInvolved ? 'failure' : 'inconclusive',
        detail: policy,
        elapsedMs: performance.now() - start,
        ...(selected ? { selected: describePair(selected) } : {}),
        close,
      });
    if (peerVerdict !== 'pass')
      return finish({
        outcome: relayInvolved ? 'failure' : 'inconclusive',
        detail:
          peerVerdict === 'timeout'
            ? 'peer path-verdict confirmation timed out'
            : 'peer did not confirm the requested selected-pair evidence',
        elapsedMs: performance.now() - start,
        ...(selected ? { selected: describePair(selected) } : {}),
        close,
      });
    const protocolVerification = localProtocolVerification(profile, selected, host);
    if (requestedRelay(profile, host))
      diagnostics.localRelayProtocolEvidence(selected?.localRelayProtocol ?? 'unavailable');
    return finish({
      outcome: 'pass',
      connectivity: 'pass',
      protocolVerification,
      detail:
        relayInvolved && protocolVerification === 'unavailable'
          ? 'relay connectivity and bidirectional application ping verified; local access-protocol evidence unavailable'
          : relayInvolved && protocolVerification === 'mismatch'
            ? 'relay connectivity and bidirectional application ping verified; local access-protocol did not match requested endpoint'
            : 'selected pair and bidirectional application ping verified',
      elapsedMs: performance.now() - start,
      ...(selected ? { selected: describePair(selected) } : {}),
      channel: active,
      close,
    });
  } catch {
    const outcome = signal?.aborted
      ? interruptedOutcome()
      : cancelled()
        ? 'cancelled'
        : performance.now() - start >= deadlineMs - 500
          ? 'timeout'
          : 'failure';
    if (outcome === 'cancelled') interrupted = 'cancelled';
    if (outcome === 'timeout' && signal?.aborted) interrupted = 'deadline';
    const detail = failureDetail(outcome);
    if (!terminalRecorded) diagnostics.emit('failure', 'failure', detail);
    return finish({
      outcome,
      detail,
      elapsedMs: performance.now() - start,
      close,
    });
  } finally {
    handshake?.dispose();
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
