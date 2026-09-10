import type { DiagnosticEvent } from '../shared/domain.js';

export type PairedProbeDiagnostic = Pick<DiagnosticEvent, 'type' | 'outcome' | 'elapsedMs'> & {
  message: string;
};
export type DiagnosticCallback = (event: PairedProbeDiagnostic) => void;

type CandidateFields = {
  candidate?: unknown;
  type?: unknown;
  protocol?: unknown;
  address?: unknown;
  port?: unknown;
  tcpType?: unknown;
  relayProtocol?: unknown;
  relatedAddress?: unknown;
  relatedPort?: unknown;
};

export type SafeCandidate = {
  type: string;
  protocol: string;
  address: string;
  port: string;
  tcpType: string;
  relayProtocol: string;
  relatedAddress: string;
  relatedPort: string;
};

const MAX_CANDIDATES = 80;
const MAX_PAIRS = 120;
const MAX_EVENTS = 320;

function safeValue(value: unknown, allowed: readonly string[] = []): string {
  return typeof value === 'string' && (allowed.length === 0 || allowed.includes(value))
    ? value
    : 'unavailable';
}
function safeId(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9_.:-]{1,80}$/i.test(value) ? value : 'unavailable';
}

function safeAddress(value: unknown): string {
  if (typeof value !== 'string' || value.length > 255) return 'unavailable';
  const address = value.trim();
  if (
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(address) ||
    (/^[0-9a-f:.]+$/i.test(address) && address.includes(':')) ||
    /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.local$/i.test(address)
  )
    return address;
  return 'unavailable';
}

function safePort(value: unknown): string {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535
    ? String(value)
    : 'unavailable';
}

/** Extract only non-secret, browser-exposed candidate fields. */
export function normalizeDiagnosticCandidate(candidate: CandidateFields): SafeCandidate {
  return {
    type: safeValue(candidate.type, ['host', 'srflx', 'prflx', 'relay']),
    protocol: safeValue(candidate.protocol, ['udp', 'tcp']),
    address: safeAddress(candidate.address),
    port: safePort(candidate.port),
    tcpType: safeValue(candidate.tcpType, ['active', 'passive', 'so']),
    relayProtocol: safeValue(candidate.relayProtocol, ['udp', 'tcp', 'tls']),
    relatedAddress: safeAddress(candidate.relatedAddress),
    relatedPort: safePort(candidate.relatedPort),
  };
}

function candidateText(candidate: SafeCandidate): string {
  const base = `${candidate.type}/${candidate.protocol} ${endpointText(candidate.address, candidate.port)} tcpType=${candidate.tcpType} relayProtocol=${candidate.relayProtocol}`;
  const related =
    candidate.relatedAddress === 'unavailable'
      ? ''
      : ` related=${endpointText(candidate.relatedAddress, candidate.relatedPort)}`;
  return base.length + related.length <= 350 ? `${base}${related}` : `${base} related=unavailable`;
}
function endpointText(address: string, port: string) {
  return `${address.includes(':') ? `[${address}]` : address}:${port}`;
}

function safeErrorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string')
    return [
      'AbortError',
      'Error',
      'InvalidStateError',
      'NetworkError',
      'NotAllowedError',
      'OperationError',
      'TypeError',
    ].includes(error.name)
      ? error.name
      : 'unavailable';
  return 'unavailable';
}

export class PairedRtcDiagnostics {
  private readonly started = performance.now();
  private readonly seenCandidates = new Set<string>();
  private readonly seenPairs = new Set<string>();
  private eventCount = 0;
  private truncated = false;
  private timer: ReturnType<typeof globalThis.setInterval> | undefined;
  private sampling = false;
  private stopped = false;
  private readonly safeProfileId: string;

  constructor(
    private readonly device: 'A' | 'B',
    profileId: string,
    private readonly onDiagnostic?: DiagnosticCallback,
  ) {
    this.safeProfileId = safeId(profileId);
  }

  emit(type: DiagnosticEvent['type'], outcome: DiagnosticEvent['outcome'], message: string) {
    if (this.stopped) return;
    if (this.eventCount >= MAX_EVENTS) {
      this.noteTruncation();
      return;
    }
    this.eventCount++;
    this.onDiagnostic?.({
      type,
      outcome,
      elapsedMs: Math.max(0, Math.round(performance.now() - this.started)),
      message: `Device ${this.device} · ${this.safeProfileId} · ${message}`.slice(0, 500),
    });
  }

  candidate(
    direction: 'local' | 'remote',
    state:
      | 'gathered'
      | 'signaled'
      | 'filtered'
      | 'received'
      | 'queued'
      | 'accepted'
      | 'rejected'
      | 'observed',
    candidate: CandidateFields,
  ) {
    if (this.stopped) return;
    const normalized = normalizeDiagnosticCandidate(candidate);
    const key = `${direction}:${state}:${JSON.stringify(normalized)}`;
    if (this.seenCandidates.has(key)) return;
    if (this.seenCandidates.size >= MAX_CANDIDATES) {
      this.noteTruncation();
      return;
    }
    this.seenCandidates.add(key);
    this.emit(
      'candidate',
      state === 'rejected' ? 'failure' : 'info',
      `${direction} candidate ${state}: ${candidateText(normalized)}`,
    );
  }

  embeddedCandidates(kind: 'offer' | 'answer', sdp: string) {
    const count = (sdp.match(/^a=candidate:/gm) ?? []).length;
    if (count)
      this.emit(
        'candidate',
        'info',
        `received ${count} candidate${count === 1 ? '' : 's'} embedded in ${kind} SDP; not labeled as trickle-signaled`,
      );
  }

  state(
    stage: 'ICE gathering' | 'ICE connection' | 'signaling' | 'remote offer' | 'remote answer',
    value: string,
  ) {
    const allowed = [
      'new',
      'gathering',
      'complete',
      'checking',
      'connected',
      'completed',
      'disconnected',
      'failed',
      'closed',
      'stable',
      'have-local-offer',
      'have-remote-offer',
      'have-local-pranswer',
      'have-remote-pranswer',
      'applied',
    ];
    this.emit('operation', 'info', `${stage} state=${safeValue(value, allowed)}`);
  }

  candidateError(error: unknown, code?: number) {
    const safeCode =
      typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 99999
        ? String(code)
        : 'unavailable';
    this.emit(
      'failure',
      'failure',
      `ICE candidate error name=${safeErrorName(error)} code=${safeCode}`,
    );
  }

  startStats(pc: RTCPeerConnection) {
    if (this.stopped || this.timer !== undefined) return;
    const sample = () => {
      void this.observeStats(pc);
    };
    sample();
    this.timer = globalThis.setInterval(sample, 1_000);
  }

  stop() {
    this.stopped = true;
    if (this.timer !== undefined) globalThis.clearInterval(this.timer);
    this.timer = undefined;
  }

  terminal(
    outcome: 'pass' | 'inconclusive' | 'timeout' | 'cancelled' | 'failure' | 'unsupported',
    pc: Pick<RTCPeerConnection, 'iceConnectionState' | 'iceGatheringState' | 'signalingState'>,
  ) {
    const safeOutcome =
      outcome === 'pass'
        ? 'success'
        : outcome === 'timeout' || outcome === 'cancelled'
          ? outcome
          : outcome === 'unsupported'
            ? 'info'
            : 'failure';
    this.emit(
      'summary',
      safeOutcome,
      `probe terminal=${outcome}; ICE connection=${safeValue(pc.iceConnectionState, ['new', 'checking', 'connected', 'completed', 'disconnected', 'failed', 'closed'])}; gathering=${safeValue(pc.iceGatheringState, ['new', 'gathering', 'complete'])}; signaling=${safeValue(pc.signalingState, ['stable', 'have-local-offer', 'have-remote-offer', 'have-local-pranswer', 'have-remote-pranswer', 'closed'])}`,
    );
  }

  async observeStats(pc: RTCPeerConnection) {
    if (this.stopped || this.sampling) return;
    this.sampling = true;
    try {
      this.reportStats(await pc.getStats());
    } catch (error) {
      this.statsUnavailable(error);
    } finally {
      this.sampling = false;
    }
  }

  reportStats(stats: RTCStatsReport) {
    if (this.stopped) return;
    const selectedIds = new Set<string>();
    for (const raw of stats.values()) {
      const transport = raw as unknown as Record<string, unknown>;
      if (transport.type === 'transport' && typeof transport.selectedCandidatePairId === 'string')
        selectedIds.add(transport.selectedCandidatePairId);
    }
    for (const raw of stats.values()) {
      const candidate = raw as unknown as Record<string, unknown>;
      if (candidate.type === 'local-candidate' || candidate.type === 'remote-candidate') {
        this.candidate(candidate.type === 'local-candidate' ? 'local' : 'remote', 'observed', {
          type: candidate.candidateType,
          protocol: candidate.protocol,
          address: candidate.address,
          port: candidate.port,
          tcpType: candidate.tcpType,
          relayProtocol: candidate.relayProtocol,
          relatedAddress: candidate.relatedAddress,
          relatedPort: candidate.relatedPort,
        });
        continue;
      }
      if (candidate.type !== 'candidate-pair') continue;
      const local = this.statCandidate(stats, candidate.localCandidateId);
      const remote = this.statCandidate(stats, candidate.remoteCandidateId);
      const state = safeValue(candidate.state, [
        'frozen',
        'waiting',
        'in-progress',
        'failed',
        'succeeded',
      ]);
      const nominated =
        typeof candidate.nominated === 'boolean' ? String(candidate.nominated) : 'unavailable';
      const id = safeId(candidate.id);
      const selected =
        candidate.selected === true || (id !== 'unavailable' && selectedIds.has(id))
          ? 'true'
          : candidate.selected === false
            ? 'false'
            : 'unavailable';
      const key = `${id}:${state}:${nominated}:${selected}:${JSON.stringify(local)}:${JSON.stringify(remote)}`;
      if (this.seenPairs.has(key)) continue;
      if (this.seenPairs.size >= MAX_PAIRS) {
        this.noteTruncation();
        return;
      }
      this.seenPairs.add(key);
      this.emit(
        'stats',
        'info',
        `observed candidate pair id=${id} state=${state} nominated=${nominated} selected=${selected}`,
      );
      this.emit(
        'stats',
        'info',
        `pair id=${id} local=${endpointText(local.address, local.port)} ${local.type}/${local.protocol}`,
      );
      this.emit(
        'stats',
        'info',
        `pair id=${id} remote=${endpointText(remote.address, remote.port)} ${remote.type}/${remote.protocol}`,
      );
    }
  }

  statsUnavailable(error: unknown) {
    this.emit('failure', 'failure', `stats unavailable name=${safeErrorName(error)}`);
  }

  private noteTruncation() {
    if (this.stopped || this.truncated) return;
    this.truncated = true;
    this.onDiagnostic?.({
      type: 'truncation',
      outcome: 'info',
      elapsedMs: Math.max(0, Math.round(performance.now() - this.started)),
      message: `Device ${this.device} · ${this.safeProfileId} · telemetry detail truncated; candidate/pair/event limit reached`,
    });
  }

  private statCandidate(stats: RTCStatsReport, id: unknown): SafeCandidate {
    const raw =
      typeof id === 'string'
        ? (stats.get(id) as unknown as Record<string, unknown> | undefined)
        : undefined;
    return normalizeDiagnosticCandidate({
      type: raw?.candidateType,
      protocol: raw?.protocol,
      address: raw?.address,
      port: raw?.port,
      tcpType: raw?.tcpType,
      relayProtocol: raw?.relayProtocol,
      relatedAddress: raw?.relatedAddress,
      relatedPort: raw?.relatedPort,
    });
  }
}
