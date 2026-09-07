import { describe, expect, it } from 'vitest';
import {
  CoordinatedPerformance,
  PERFORMANCE_DEFAULTS,
  receiverResult,
  summarizeRtt,
} from '../src/client/performance.js';

function linkedChannels(): [RTCDataChannel, RTCDataChannel] {
  const listeners: [Set<(event: MessageEvent) => void>, Set<(event: MessageEvent) => void>] = [
    new Set(),
    new Set(),
  ];
  const channel = (side: 0 | 1) =>
    ({
      readyState: 'open',
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'message') listeners[side].add(listener as (event: MessageEvent) => void);
      },
      removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'message') listeners[side].delete(listener as (event: MessageEvent) => void);
      },
      send: (data: string | ArrayBuffer | ArrayBufferView) => {
        for (const listener of listeners[side === 0 ? 1 : 0])
          listener(new MessageEvent('message', { data }));
      },
    }) as unknown as RTCDataChannel;
  return [channel(0), channel(1)];
}

describe('coordinated performance protocol primitives', () => {
  it('keeps production traffic caps and derives goodput from receiver time', () => {
    expect(PERFORMANCE_DEFAULTS.chunkBytes).toBeLessThanOrEqual(16 * 1024);
    expect(PERFORMANCE_DEFAULTS.maxDirectionBytes).toBe(8 * 1024 * 1024);
    expect(PERFORMANCE_DEFAULTS.maxTotalBytes).toBe(16 * 1024 * 1024);
    expect(receiverResult('a-to-b', 125_000, 50, 1_050, 'byte cap')).toMatchObject({
      bytes: 125_000,
      elapsedMs: 1_000,
      mbps: 1,
    });
  });
  it('reports bounded unanswered pings without inventing RTT samples', () => {
    expect(summarizeRtt([4, 8, 12], 17)).toEqual({
      min: 4,
      median: 8,
      p95: 12,
      max: 12,
      count: 3,
      unanswered: 17,
    });
  });
  it('honors either participant opting out before sending performance traffic', async () => {
    const [hostChannel, guestChannel] = linkedChannels();
    const host = new CoordinatedPerformance(hostChannel, true, {}, undefined, true);
    const guest = new CoordinatedPerformance(guestChannel, false, {}, undefined, false);

    const [hostResult, guestResult] = await Promise.all([host.run(), guest.run()]);

    expect(hostResult.skippedReason).toMatch(/disabled by a participant/i);
    expect(guestResult.skippedReason).toMatch(/disabled by a participant/i);
    expect(hostResult.directions).toEqual([]);
    expect(guestResult.directions).toEqual([]);
    host.dispose();
    guest.dispose();
  });
});
