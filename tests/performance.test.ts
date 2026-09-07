import { describe, expect, it } from 'vitest';
import { PERFORMANCE_DEFAULTS, receiverResult, summarizeRtt } from '../src/client/performance.js';

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
});
