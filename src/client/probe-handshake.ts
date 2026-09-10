import { createId } from '../shared/domain.js';

type ProbeChannel = Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & {
  readonly readyState: string;
  send(data: string): void;
};
type Verdict = 'pass' | 'inconclusive' | 'timeout';
type Trace = (message: string) => void;

/** Installed at channel acquisition, before either peer can start its challenge. */
export class ProbeHandshake {
  private readonly nonce = createId('ping');
  private stopped = false;
  private peerVerdict: Exclude<Verdict, 'timeout'> | undefined;
  private finishPong: ((value: boolean) => void) | undefined;
  private finishVerdict: ((value: Verdict) => void) | undefined;
  private pong: Promise<boolean> | undefined;
  private verdict: Promise<Verdict> | undefined;
  private retry: ReturnType<typeof setInterval> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;
  private verdictTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly channel: ProbeChannel,
    private readonly trace: Trace,
    private readonly signal?: AbortSignal,
  ) {
    channel.addEventListener('message', this.receive);
    channel.addEventListener('close', this.dispose);
    channel.addEventListener('error', this.dispose);
    signal?.addEventListener('abort', this.dispose, { once: true });
    if (signal?.aborted) this.dispose();
  }

  private receive = (event: Event) => {
    if (this.stopped || !(event instanceof MessageEvent) || typeof event.data !== 'string') return;
    const data: string = event.data;
    const ping = /^probe-ping:(ping_[a-f0-9]{32})$/.exec(data);
    if (ping && this.channel.readyState === 'open') {
      this.trace('application ping received; pong sent');
      this.send(`probe-pong:${ping[1]}`);
    } else if (data === `probe-pong:${this.nonce}`) {
      this.finishPong?.(true);
    } else if (data === 'probe-verdict:pass' || data === 'probe-verdict:inconclusive') {
      if (this.peerVerdict !== undefined) return;
      this.peerVerdict = data === 'probe-verdict:pass' ? 'pass' : 'inconclusive';
      this.trace(`peer verdict received=${this.peerVerdict}`);
      this.finishVerdict?.(this.peerVerdict);
    }
  };

  verify(): Promise<boolean> {
    if (this.pong) return this.pong;
    this.pong = new Promise<boolean>((resolve) => {
      if (this.stopped) {
        resolve(false);
        return;
      }
      this.finishPong = (value) => {
        if (!this.finishPong) return;
        this.finishPong = undefined;
        clearTimeout(this.pongTimer);
        clearInterval(this.retry);
        if (value) this.trace('application pong received');
        else if (!this.stopped) this.trace('application ping deadline reached');
        resolve(value);
      };
      this.pongTimer = setTimeout(() => this.finishPong?.(false), 3_000);
      let sends = 0;
      const send = () => {
        if (this.stopped || !this.finishPong || this.channel.readyState !== 'open') return;
        this.trace(sends++ === 0 ? 'application ping sent' : 'application ping retried');
        this.send(`probe-ping:${this.nonce}`);
      };
      // A channel can open before its peer's application listener is installed.
      this.retry = setInterval(send, 200);
      send();
    });
    return this.pong;
  }

  confirm(localPass: boolean): Promise<Verdict> {
    if (this.verdict) return this.verdict;
    this.verdict = new Promise<Verdict>((resolve) => {
      if (this.stopped || this.channel.readyState !== 'open') {
        resolve('timeout');
        return;
      }
      this.finishVerdict = (value) => {
        if (!this.finishVerdict) return;
        this.finishVerdict = undefined;
        clearTimeout(this.verdictTimer);
        resolve(value);
      };
      this.verdictTimer = setTimeout(() => this.finishVerdict?.('timeout'), 3_000);
      this.trace(`local verdict sent=${localPass ? 'pass' : 'inconclusive'}`);
      this.send(`probe-verdict:${localPass ? 'pass' : 'inconclusive'}`);
      if (this.peerVerdict !== undefined) this.finishVerdict?.(this.peerVerdict);
    });
    return this.verdict;
  }

  private send(message: string) {
    try {
      this.channel.send(message);
    } catch {
      this.trace('probe message send failed');
      this.dispose();
    }
  }

  dispose = () => {
    if (this.stopped) return;
    this.stopped = true;
    this.finishPong?.(false);
    this.finishVerdict?.('timeout');
    clearInterval(this.retry);
    clearTimeout(this.pongTimer);
    clearTimeout(this.verdictTimer);
    this.channel.removeEventListener('message', this.receive);
    this.channel.removeEventListener('close', this.dispose);
    this.channel.removeEventListener('error', this.dispose);
    this.signal?.removeEventListener('abort', this.dispose);
  };
}
