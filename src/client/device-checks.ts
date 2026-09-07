import { sanitizeIceConfig, type IceConfig } from '../shared/domain.js';
import { probeIce, type ProbeIceOptions } from './webrtc.js';

export type DeviceCheckOutcome =
  'pass' | 'failure' | 'timeout' | 'cancelled' | 'unsupported' | 'inconclusive' | 'not-configured';
export type DeviceCheckPhase = 'idle' | 'checking' | 'complete' | 'cancelled';
export type DeviceCheckResult = {
  id: string;
  label: string;
  outcome: DeviceCheckOutcome;
  elapsedMs: number;
  candidateTypes?: Array<'host' | 'srflx' | 'prflx' | 'relay' | 'unavailable'>;
};
export type DeviceCheckSnapshot = {
  generation: number;
  configurationVersion: string;
  phase: DeviceCheckPhase;
  progress: { completed: number; total: number };
  blockingPrerequisites: string[];
  ready: boolean;
  results: DeviceCheckResult[];
};
export type DeviceCheckStart = { configuration: IceConfig; configurationVersion: string };
export type ReachabilityCheck = (context: { signal: AbortSignal }) => Promise<void>;
export type DeviceCheckEnvironment = {
  secureContext: boolean;
  hasPeerConnection: boolean;
  hasDataChannel: boolean;
  hasRuntime: boolean;
  rtcFactory: (configuration: RTCConfiguration) => RTCPeerConnection;
  now: () => number;
  setTimeout: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};
export type DeviceCheckOptions = {
  checkSignaling?: ReachabilityCheck;
  environment?: Partial<DeviceCheckEnvironment>;
  probeDeadlineMs?: number;
  concurrency?: number;
};

const defaultEnvironment = (): DeviceCheckEnvironment => ({
  secureContext: globalThis.isSecureContext,
  hasPeerConnection: typeof RTCPeerConnection !== 'undefined',
  hasDataChannel:
    typeof RTCPeerConnection !== 'undefined' &&
    typeof RTCPeerConnection.prototype.createDataChannel === 'function',
  hasRuntime:
    typeof RTCPeerConnection !== 'undefined' &&
    typeof RTCPeerConnection.prototype.createOffer === 'function' &&
    typeof RTCPeerConnection.prototype.setLocalDescription === 'function',
  rtcFactory: (configuration) => new RTCPeerConnection(configuration),
  now: () => performance.now(),
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (timer) => globalThis.clearTimeout(timer),
});

function publicCandidateTypes(result: Awaited<ReturnType<typeof probeIce>>) {
  return [...new Set(result.candidates.map((candidate) => candidate.type))];
}

/**
 * A React-independent, disposable device-only preflight controller. It never
 * treats ICE gathering as proof that a peer can be reached.
 */
export class DeviceCheckController {
  private readonly checkSignaling: ReachabilityCheck | undefined;
  private readonly environment: DeviceCheckEnvironment;
  private readonly probeDeadlineMs: number;
  private readonly concurrency: number;
  private listeners = new Set<(snapshot: DeviceCheckSnapshot) => void>();
  private abort: AbortController | undefined;
  private active: Promise<DeviceCheckSnapshot> | undefined;
  private generation = 0;
  private snapshot: DeviceCheckSnapshot = {
    generation: 0,
    configurationVersion: '',
    phase: 'idle',
    progress: { completed: 0, total: 0 },
    blockingPrerequisites: ['Device checks have not run.'],
    ready: false,
    results: [],
  };

  constructor(options: DeviceCheckOptions = {}) {
    this.checkSignaling = options.checkSignaling;
    this.environment = { ...defaultEnvironment(), ...options.environment };
    this.probeDeadlineMs = options.probeDeadlineMs ?? 15_000;
    this.concurrency = Math.max(1, Math.min(3, options.concurrency ?? 3));
  }

  get current(): DeviceCheckSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: DeviceCheckSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  start(input: DeviceCheckStart): Promise<DeviceCheckSnapshot> {
    if (
      this.active &&
      this.snapshot.phase === 'checking' &&
      this.snapshot.configurationVersion === input.configurationVersion
    )
      return this.active;
    this.cancel();
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    const tasks = this.tasks(input, abort.signal);
    this.snapshot = {
      generation,
      configurationVersion: input.configurationVersion,
      phase: 'checking',
      progress: { completed: 0, total: tasks.length },
      blockingPrerequisites: [],
      ready: false,
      results: [],
    };
    this.emit();
    this.active = this.execute(generation, input.configurationVersion, tasks, abort.signal);
    return this.active;
  }

  recheck(input: DeviceCheckStart): Promise<DeviceCheckSnapshot> {
    return this.start(input);
  }

  cancel(): void {
    if (!this.abort) return;
    const cancelledGeneration = this.generation;
    this.abort.abort();
    this.abort = undefined;
    if (this.snapshot.generation !== cancelledGeneration || this.snapshot.phase !== 'checking')
      return;
    this.snapshot = {
      ...this.snapshot,
      phase: 'cancelled',
      ready: false,
      blockingPrerequisites: ['Device checks were cancelled.'],
      results: this.snapshot.results.map((result) =>
        result.outcome === 'inconclusive' ? { ...result, outcome: 'cancelled' as const } : result,
      ),
    };
    this.emit();
  }

  private tasks(
    input: DeviceCheckStart,
    signal: AbortSignal,
  ): Array<() => Promise<DeviceCheckResult>> {
    const browser = this.browserResult();
    const tasks: Array<() => Promise<DeviceCheckResult>> = [() => Promise.resolve(browser)];
    tasks.push(() => this.signaling(signal));
    if (browser.outcome === 'pass') tasks.push(() => this.localGathering(signal));
    const configured = sanitizeIceConfig(input.configuration);
    const hasStun = configured.some((server) => server.kind === 'stun');
    const hasTurn = configured.some((server) => server.kind === 'turn');
    if (!hasStun) tasks.push(() => Promise.resolve(this.notConfigured('stun', 'STUN discovery')));
    if (!hasTurn)
      tasks.push(() => Promise.resolve(this.notConfigured('turn', 'TURN relay allocation')));
    const sources = input.configuration.iceServers.flatMap((value) => {
      const urls = typeof value.urls === 'string' ? [value.urls] : value.urls;
      return urls.map((url) => ({
        urls: url,
        ...(value.username ? { username: value.username } : {}),
        ...(value.credential ? { credential: value.credential } : {}),
      }));
    });
    for (const [index, endpoint] of configured.entries()) {
      const source = sources[index];
      if (source) tasks.push(() => this.endpoint(endpoint.id, endpoint.kind, source, signal));
    }
    return tasks;
  }

  private browserResult(): DeviceCheckResult {
    const start = this.environment.now();
    const outcome =
      this.environment.secureContext &&
      this.environment.hasPeerConnection &&
      this.environment.hasDataChannel &&
      this.environment.hasRuntime
        ? 'pass'
        : 'unsupported';
    return {
      id: 'browser',
      label: 'Browser WebRTC support',
      outcome,
      elapsedMs: Math.round(this.environment.now() - start),
    };
  }

  private async signaling(signal: AbortSignal): Promise<DeviceCheckResult> {
    const started = this.environment.now();
    if (!this.checkSignaling)
      return this.notConfigured('signaling', 'Signaling reachability', started);
    const outcome = await this.bounded(
      () => this.checkSignaling?.({ signal }) ?? Promise.resolve(),
      signal,
    );
    return {
      id: 'signaling',
      label: 'Signaling reachability',
      outcome,
      elapsedMs: Math.round(this.environment.now() - started),
    };
  }

  private async localGathering(signal: AbortSignal): Promise<DeviceCheckResult> {
    const result = await probeIce(undefined, this.probeOptions(signal));
    return {
      id: 'local',
      label: 'Local candidate gathering',
      outcome: this.probeOutcome(result.outcome),
      elapsedMs: result.elapsedMs,
      candidateTypes: publicCandidateTypes(result),
    };
  }

  private async endpoint(
    id: string,
    kind: 'stun' | 'turn',
    server: RTCIceServer,
    signal: AbortSignal,
  ): Promise<DeviceCheckResult> {
    const result = await probeIce(server, this.probeOptions(signal));
    return {
      id,
      label: kind === 'turn' ? 'TURN relay allocation' : 'STUN mapped-address discovery',
      outcome: this.probeOutcome(result.outcome),
      elapsedMs: result.elapsedMs,
      candidateTypes: publicCandidateTypes(result),
    };
  }

  private probeOptions(signal: AbortSignal): ProbeIceOptions {
    return {
      timeoutMs: this.probeDeadlineMs,
      signal,
      rtcFactory: this.environment.rtcFactory,
      now: this.environment.now,
      setTimeout: this.environment.setTimeout,
      clearTimeout: this.environment.clearTimeout,
    };
  }

  private notConfigured(
    id: string,
    label: string,
    started = this.environment.now(),
  ): DeviceCheckResult {
    return {
      id,
      label,
      outcome: 'not-configured',
      elapsedMs: Math.round(this.environment.now() - started),
    };
  }

  private probeOutcome(
    outcome: Awaited<ReturnType<typeof probeIce>>['outcome'],
  ): DeviceCheckOutcome {
    return outcome === 'success' ? 'pass' : outcome;
  }

  private bounded(work: () => Promise<void>, signal: AbortSignal): Promise<DeviceCheckOutcome> {
    return new Promise((resolve) => {
      let finished = false;
      const finish = (outcome: DeviceCheckOutcome) => {
        if (finished) return;
        finished = true;
        this.environment.clearTimeout(timer);
        signal.removeEventListener('abort', cancelled);
        resolve(outcome);
      };
      const timer = this.environment.setTimeout(() => finish('timeout'), this.probeDeadlineMs);
      const cancelled = () => finish('cancelled');
      if (signal.aborted) return cancelled();
      signal.addEventListener('abort', cancelled, { once: true });
      void work().then(
        () => finish('pass'),
        () => finish('failure'),
      );
    });
  }

  private async execute(
    generation: number,
    configurationVersion: string,
    tasks: Array<() => Promise<DeviceCheckResult>>,
    signal: AbortSignal,
  ): Promise<DeviceCheckSnapshot> {
    let next = 0;
    const run = async () => {
      for (;;) {
        const index = next++;
        const task = tasks[index];
        if (!task) return;
        const result = await task().catch(() => ({
          id: `internal-${index}`,
          label: 'Device check',
          outcome: 'failure' as const,
          elapsedMs: 0,
        }));
        if (!this.isCurrent(generation, configurationVersion, signal)) return;
        this.snapshot = {
          ...this.snapshot,
          progress: { ...this.snapshot.progress, completed: this.snapshot.progress.completed + 1 },
          results: [...this.snapshot.results, result],
        };
        this.emit();
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, tasks.length) }, run));
    if (!this.isCurrent(generation, configurationVersion, signal)) return this.snapshot;
    const blockingPrerequisites = this.blocking(this.snapshot.results);
    this.snapshot = {
      ...this.snapshot,
      phase: 'complete',
      blockingPrerequisites,
      ready: blockingPrerequisites.length === 0,
    };
    this.abort = undefined;
    this.active = undefined;
    this.emit();
    return this.snapshot;
  }

  private blocking(results: DeviceCheckResult[]): string[] {
    const browser = results.find((result) => result.id === 'browser');
    const signaling = results.find((result) => result.id === 'signaling');
    const blocking: string[] = [];
    if (browser?.outcome !== 'pass')
      blocking.push('This browser cannot run the required WebRTC checks.');
    if (signaling?.outcome !== 'pass')
      blocking.push('Signaling reachability must succeed before joining a room.');
    return blocking;
  }

  private isCurrent(
    generation: number,
    configurationVersion: string,
    signal: AbortSignal,
  ): boolean {
    return (
      !signal.aborted &&
      this.snapshot.generation === generation &&
      this.snapshot.configurationVersion === configurationVersion &&
      this.snapshot.phase === 'checking'
    );
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
