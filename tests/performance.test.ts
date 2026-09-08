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
  it('keeps adaptive production traffic caps and derives goodput from receiver time', () => {
    expect(PERFORMANCE_DEFAULTS.chunkBytes).toBeLessThanOrEqual(16 * 1024);
    expect(PERFORMANCE_DEFAULTS.targetDirectionBytes).toBe(8 * 1024 * 1024);
    expect(PERFORMANCE_DEFAULTS.minSampleDurationMs).toBe(3_000);
    expect(PERFORMANCE_DEFAULTS.maxDirectionBytes).toBe(100 * 1024 * 1024);
    expect(PERFORMANCE_DEFAULTS.maxTotalBytes).toBe(200 * 1024 * 1024);
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

    expect(hostResult.skippedReason).toMatch(/turned off by a participant/i);
    expect(guestResult.skippedReason).toMatch(/turned off by a participant/i);
    expect(hostResult.directions).toEqual([]);
    expect(guestResult.directions).toEqual([]);
    host.dispose();
    guest.dispose();
  });
  it('shares host-measured RTT results with the other participant', async () => {
    const [hostChannel, guestChannel] = linkedChannels();
    const limits = {
      pingCount: 2,
      pingIntervalMs: 1,
      pingTimeoutMs: 25,
      maxDurationMs: 25,
      maxDirectionBytes: 32,
      maxTotalBytes: 64,
      chunkBytes: 16,
      highWaterBytes: 1024,
    };
    const host = new CoordinatedPerformance(hostChannel, true, limits);
    const guest = new CoordinatedPerformance(guestChannel, false, limits);

    const [hostResult, guestResult] = await Promise.all([host.run(), guest.run()]);

    expect(hostResult.rtts).toHaveLength(2);
    expect(guestResult.rtts).toEqual(hostResult.rtts);
    expect(guestResult.unanswered).toBe(hostResult.unanswered);
    expect(guestResult.directions).toHaveLength(2);
    host.dispose();
    guest.dispose();
  });
});
