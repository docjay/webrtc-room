import { createId, goodputMbps, percentile } from '../shared/domain.js';

export const PERFORMANCE_DEFAULTS = {
  pingCount: 20,
  pingIntervalMs: 100,
  pingTimeoutMs: 1_000,
  maxDurationMs: 5_000,
  minSampleDurationMs: 3_000,
  targetDirectionBytes: 8 * 1024 * 1024,
  maxDirectionBytes: 100 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  chunkBytes: 16 * 1024,
  highWaterBytes: 256 * 1024,
} as const;
export type PerformanceLimits = {
  pingCount: number;
  pingIntervalMs: number;
  pingTimeoutMs: number;
  maxDurationMs: number;
  minSampleDurationMs: number;
  targetDirectionBytes: number;
  maxDirectionBytes: number;
  maxTotalBytes: number;
  chunkBytes: number;
  highWaterBytes: number;
};
export type DirectionResult = {
  direction: 'a-to-b' | 'b-to-a';
  bytes: number;
  elapsedMs: number;
  mbps?: number;
  reason: string;
};
export type PerformanceResult = {
  rtts: number[];
  unanswered: number;
  directions: DirectionResult[];
  cancelled: boolean;
  skippedReason?: string;
};
export type PerformanceProgress =
  | { phase: 'preference'; label: string }
  | { phase: 'rtt'; label: string }
  | { phase: 'direction'; direction: DirectionResult['direction']; label: string };
type Control =
  | { perf: true; type: 'preference'; enabled: boolean }
  | { perf: true; type: 'rtt-ping'; id: string }
  | { perf: true; type: 'rtt-pong'; id: string }
  | { perf: true; type: 'rtt-result'; rtts: number[]; unanswered: number }
  | { perf: true; type: 'start'; direction: DirectionResult['direction'] }
  | { perf: true; type: 'send'; direction: DirectionResult['direction'] }
  | { perf: true; type: 'end'; direction: DirectionResult['direction']; reason: string }
  | { perf: true; type: 'result'; result: DirectionResult }
  | { perf: true; type: 'cancel' };

function control(data: unknown): Control | undefined {
  if (typeof data !== 'string') return undefined;
  try {
    const value = JSON.parse(data) as Record<string, unknown>;
    return value.perf === true && typeof value.type === 'string' ? (value as Control) : undefined;
  } catch {
    return undefined;
  }
}
export function summarizeRtt(rtts: number[], unanswered: number) {
  return {
    min: rtts.length ? Math.min(...rtts) : undefined,
    median: percentile(rtts, 0.5),
    p95: percentile(rtts, 0.95),
    max: rtts.length ? Math.max(...rtts) : undefined,
    count: rtts.length,
    unanswered,
  };
}
export function receiverResult(
  direction: DirectionResult['direction'],
  bytes: number,
  startedAt: number,
  endedAt: number,
  reason: string,
): DirectionResult {
  const elapsedMs = Math.max(0, endedAt - startedAt);
  const mbps = goodputMbps(bytes, elapsedMs);
  return { direction, bytes, elapsedMs, ...(mbps === undefined ? {} : { mbps }), reason };
}

function formatByteLimit(bytes: number) {
  const mebibytes = bytes / (1024 * 1024);
  return Number.isInteger(mebibytes) && mebibytes >= 1 ? `${mebibytes} MiB` : `${bytes} byte`;
}

export class CoordinatedPerformance {
  private readonly limits: PerformanceLimits;
  private readonly starts = new Map<string, number>();
  private readonly rttReplies = new Map<string, number>();
  private readonly receiver = new Map<
    DirectionResult['direction'],
    { bytes: number; startedAt: number }
  >();
  private readonly results = new Map<DirectionResult['direction'], DirectionResult>();
  private remotePreference: boolean | undefined;
  private remoteRtt: { rtts: number[]; unanswered: number } | undefined;
  private cancelled = false;
  private onResult: ((result: DirectionResult) => void) | undefined;
  private onProgress: ((progress: PerformanceProgress) => void) | undefined;
  private totalSent = 0;
  public constructor(
    private readonly channel: RTCDataChannel,
    private readonly host: boolean,
    limits: Partial<PerformanceLimits> = {},
    private readonly now = () => performance.now(),
    private readonly automaticEnabled = true,
  ) {
    this.limits = { ...PERFORMANCE_DEFAULTS, ...limits };
    channel.bufferedAmountLowThreshold = this.limits.highWaterBytes / 2;
    channel.addEventListener('message', this.onMessage);
  }
  dispose() {
    this.channel.removeEventListener('message', this.onMessage);
  }
  cancel() {
    this.cancelled = true;
    this.send({ perf: true, type: 'cancel' });
  }
  async run(
    onResult?: (result: DirectionResult) => void,
    onProgress?: (progress: PerformanceProgress) => void,
  ): Promise<PerformanceResult> {
    this.onResult = onResult;
    this.onProgress = onProgress;
    this.onProgress?.({
      phase: 'preference',
      label: 'Confirming both participants allow the speed check',
    });
    const preference = await this.synchronizePreference();
    if (!preference)
      return {
        rtts: [],
        unanswered: 0,
        directions: [],
        cancelled: false,
        skippedReason:
          this.remotePreference === false || !this.automaticEnabled
            ? 'The automatic connection speed check was turned off by a participant.'
            : 'The other participant did not confirm the automatic connection speed check.',
      };
    if (!this.host) return this.waitForCompletion();
    this.onProgress?.({ phase: 'rtt', label: 'Measuring round-trip time' });
    const rtts = await this.runRtt();
    const unanswered = this.limits.pingCount - rtts.length;
    this.send({ perf: true, type: 'rtt-result', rtts, unanswered });
    if (!this.cancelled) await this.runDirection('a-to-b');
    if (!this.cancelled) await this.runDirection('b-to-a');
    return {
      rtts,
      unanswered,
      directions: (['a-to-b', 'b-to-a'] as const).flatMap((key) => {
        const result = this.results.get(key);
        return result ? [result] : [];
      }),
      cancelled: this.cancelled,
    };
  }
  private readonly onMessage = (event: MessageEvent) => {
    const message = control(event.data);
    if (!message) {
      if (event.data instanceof ArrayBuffer || ArrayBuffer.isView(event.data)) {
        for (const receiver of this.receiver.values()) receiver.bytes += event.data.byteLength;
      }
      return;
    }
    if (message.type === 'preference') this.remotePreference = message.enabled;
    else if (message.type === 'rtt-result')
      this.remoteRtt = { rtts: message.rtts, unanswered: message.unanswered };
    else if (message.type === 'rtt-ping') {
      this.onProgress?.({ phase: 'rtt', label: 'Measuring round-trip time' });
      this.send({ perf: true, type: 'rtt-pong', id: message.id });
    } else if (message.type === 'rtt-pong') {
      const startedAt = this.starts.get(message.id);
      if (startedAt !== undefined) this.rttReplies.set(message.id, this.now() - startedAt);
    } else if (message.type === 'start') {
      this.onProgress?.({
        phase: 'direction',
        direction: message.direction,
        label: 'Measuring the other device to this device',
      });
      this.receiver.set(message.direction, {
        bytes: 0,
        startedAt: this.now(),
      });
    } else if (message.type === 'send') {
      this.onProgress?.({
        phase: 'direction',
        direction: message.direction,
        label: 'Measuring this device to the other device',
      });
      void this.sendDirection(message.direction);
    } else if (message.type === 'end') {
      const direction = message.direction;
      const measured = this.receiver.get(direction);
      if (measured) {
        const result = receiverResult(
          direction,
          measured.bytes,
          measured.startedAt,
          this.now(),
          message.reason,
        );
        this.receiver.delete(direction);
        this.results.set(direction, result);
        this.onResult?.(result);
        this.send({ perf: true, type: 'result', result });
      }
    } else if (message.type === 'result') {
      this.results.set(message.result.direction, message.result);
      this.onResult?.(message.result);
      if (this.host) this.send(message);
    } else if (message.type === 'cancel') this.cancelled = true;
  };
  private send(message: Control) {
    if (this.channel.readyState === 'open') this.channel.send(JSON.stringify(message));
  }
  private async synchronizePreference() {
    const deadline = this.now() + 3_000;
    while (!this.cancelled && this.remotePreference === undefined && this.now() < deadline) {
      this.send({ perf: true, type: 'preference', enabled: this.automaticEnabled });
      await this.sleep(100);
    }
    this.send({ perf: true, type: 'preference', enabled: this.automaticEnabled });
    return !this.cancelled && this.automaticEnabled && this.remotePreference === true;
  }
  private async runRtt() {
    const ids: string[] = [];
    for (let index = 0; index < this.limits.pingCount && !this.cancelled; index++) {
      const id = `${index}-${createId('rtt')}`;
      ids.push(id);
      this.starts.set(id, this.now());
      this.send({ perf: true, type: 'rtt-ping', id });
      if (index + 1 < this.limits.pingCount) await this.sleep(this.limits.pingIntervalMs);
    }
    const replyDeadline = this.now() + this.limits.pingTimeoutMs;
    while (
      !this.cancelled &&
      ids.some((id) => !this.rttReplies.has(id)) &&
      this.now() < replyDeadline
    )
      await this.sleep(20);
    const received = ids.flatMap((id) => {
      const rtt = this.rttReplies.get(id);
      this.starts.delete(id);
      this.rttReplies.delete(id);
      return rtt === undefined ? [] : [rtt];
    });
    return received;
  }
  private async runDirection(direction: DirectionResult['direction']) {
    this.onProgress?.({
      phase: 'direction',
      direction,
      label:
        direction === 'a-to-b'
          ? 'Measuring this device to the other device'
          : 'Measuring the other device to this device',
    });
    if (direction === 'a-to-b') {
      this.send({ perf: true, type: 'start', direction });
      await this.sendDirection(direction);
    } else {
      this.receiver.set(direction, { bytes: 0, startedAt: this.now() });
      this.send({ perf: true, type: 'send', direction });
    }
    const deadline = this.now() + this.limits.maxDurationMs + 2_000;
    while (!this.cancelled && !this.results.has(direction) && this.now() < deadline)
      await this.sleep(20);
    if (!this.results.has(direction) && !this.cancelled)
      this.results.set(direction, {
        direction,
        bytes: 0,
        elapsedMs: 0,
        reason: 'receiver result timeout',
      });
  }
  private async sendDirection(direction: DirectionResult['direction']) {
    const startedAt = this.now();
    let sent = 0;
    let reason = 'measurement time reached';
    const chunk = new Uint8Array(this.limits.chunkBytes);
    while (
      !this.cancelled &&
      (sent < this.limits.targetDirectionBytes ||
        this.now() - startedAt < this.limits.minSampleDurationMs) &&
      sent + chunk.byteLength <= this.limits.maxDirectionBytes &&
      this.totalSent + chunk.byteLength <= this.limits.maxTotalBytes &&
      this.now() - startedAt < this.limits.maxDurationMs
    ) {
      await this.drain();
      if (this.cancelled || this.channel.readyState !== 'open') {
        reason = 'cancelled or channel closed';
        break;
      }
      this.channel.send(chunk);
      sent += chunk.byteLength;
      this.totalSent += chunk.byteLength;
    }
    const elapsedMs = this.now() - startedAt;
    if (this.cancelled) reason = 'cancelled';
    else if (elapsedMs >= this.limits.maxDurationMs) reason = 'duration cap';
    else if (sent + chunk.byteLength > this.limits.maxDirectionBytes)
      reason =
        elapsedMs < this.limits.minSampleDurationMs
          ? `${formatByteLimit(this.limits.maxDirectionBytes)} traffic limit reached before ${this.limits.minSampleDurationMs / 1_000} s goal`
          : 'byte safety cap';
    else if (this.totalSent + chunk.byteLength > this.limits.maxTotalBytes)
      reason = 'total byte safety cap';
    this.send({ perf: true, type: 'end', direction, reason });
  }
  private drain() {
    if (this.channel.bufferedAmount <= this.limits.highWaterBytes) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        window.clearTimeout(timer);
        this.channel.removeEventListener('bufferedamountlow', done);
        resolve();
      };
      const timer = window.setTimeout(done, 200);
      this.channel.addEventListener('bufferedamountlow', done, { once: true });
    });
  }
  private async waitForCompletion(): Promise<PerformanceResult> {
    while (!this.cancelled && (this.results.size < 2 || !this.remoteRtt)) await this.sleep(50);
    return {
      rtts: this.remoteRtt?.rtts ?? [],
      unanswered: this.remoteRtt?.unanswered ?? 0,
      directions: [...this.results.values()],
      cancelled: this.cancelled,
    };
  }
  private sleep(ms: number) {
    return new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));
  }
}
