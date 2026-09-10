import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProbeHandshake } from '../src/client/probe-handshake.js';

class Channel extends EventTarget {
  readyState = 'open';
  peer?: Channel;
  sent: string[] = [];
  dropFirstPing = false;
  send(data: string) {
    this.sent.push(data);
    if (this.dropFirstPing && data.startsWith('probe-ping:')) {
      this.dropFirstPing = false;
      return;
    }
    this.peer?.dispatchEvent(new MessageEvent('message', { data }));
  }
}

afterEach(() => vi.useRealTimers());

describe('bounded bilateral probe handshake', () => {
  it('recovers a lost early challenge and requires each matching round trip', async () => {
    vi.useFakeTimers();
    const a = new Channel();
    const b = new Channel();
    a.peer = b;
    b.peer = a;
    b.dropFirstPing = true;
    const left = new ProbeHandshake(a, () => undefined);
    const right = new ProbeHandshake(b, () => undefined);
    try {
      const leftPing = left.verify();
      const rightPing = right.verify();
      await expect(leftPing).resolves.toBe(true);
      expect(b.sent.filter((value) => value.startsWith('probe-ping:'))).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(200);
      await expect(rightPing).resolves.toBe(true);
      expect(b.sent.filter((value) => value.startsWith('probe-ping:'))).toHaveLength(2);
      await expect(Promise.all([left.confirm(true), right.confirm(true)])).resolves.toEqual([
        'pass',
        'pass',
      ]);
    } finally {
      left.dispose();
      right.dispose();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores unrelated pongs and stops retries at its deadline', async () => {
    vi.useFakeTimers();
    const channel = new Channel();
    const protocol = new ProbeHandshake(channel, () => undefined);
    const result = protocol.verify();
    channel.dispatchEvent(new MessageEvent('message', { data: 'pong' }));
    channel.dispatchEvent(
      new MessageEvent('message', { data: `probe-pong:ping_${'0'.repeat(32)}` }),
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(result).resolves.toBe(false);
    const count = channel.sent.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(channel.sent.length).toBe(count);
    expect(count).toBeLessThanOrEqual(15);
    protocol.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('buffers an early negative verdict rather than accepting local evidence alone', async () => {
    const channel = new Channel();
    const protocol = new ProbeHandshake(channel, () => undefined);
    channel.dispatchEvent(new MessageEvent('message', { data: 'probe-verdict:inconclusive' }));
    await expect(protocol.confirm(true)).resolves.toBe('inconclusive');
    protocol.dispose();
  });

  it('surfaces send failures and clears pending work', async () => {
    vi.useFakeTimers();
    const channel = new Channel();
    channel.send = () => {
      throw new DOMException('closed', 'InvalidStateError');
    };
    const trace = vi.fn();
    const protocol = new ProbeHandshake(channel, trace);
    await expect(protocol.verify()).resolves.toBe(false);
    await expect(protocol.confirm(true)).resolves.toBe('timeout');
    expect(trace).toHaveBeenCalledWith('probe message send failed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['abort', 'close'] as const)(
    'immediately settles and cleans up on %s',
    async (reason) => {
      vi.useFakeTimers();
      const channel = new Channel();
      const abort = new AbortController();
      const protocol = new ProbeHandshake(channel, () => undefined, abort.signal);
      const ping = protocol.verify();
      const verdict = protocol.confirm(true);
      if (reason === 'abort') abort.abort();
      else channel.dispatchEvent(new Event('close'));
      await expect(ping).resolves.toBe(false);
      await expect(verdict).resolves.toBe('timeout');
      expect(vi.getTimerCount()).toBe(0);
      const count = channel.sent.length;
      channel.dispatchEvent(
        new MessageEvent('message', { data: `probe-ping:ping_${'1'.repeat(32)}` }),
      );
      expect(channel.sent).toHaveLength(count);
    },
  );
});
