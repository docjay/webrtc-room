import { describe, expect, it } from 'vitest';
import { scheduleCapabilityCategories } from '../src/client/capability-scheduler.js';
import type { DiagnosticCategory } from '../src/shared/domain.js';

const categories: DiagnosticCategory[] = [
  {
    id: 'turn-udp',
    label: 'TURN UDP',
    tier: 1,
    alternatives: [
      {
        id: 'pair-turn-udp-0',
        a: 'turn-udp-0',
        b: 'turn-udp-0',
        aLabel: 'TURN A',
        bLabel: 'TURN B',
        tier: 1,
        status: 'queued',
      },
      {
        id: 'pair-turn-udp-1',
        a: 'turn-udp-1',
        b: 'turn-udp-1',
        aLabel: 'TURN A fallback',
        bLabel: 'TURN B fallback',
        tier: 1,
        status: 'queued',
      },
    ],
  },
  { id: 'turn-tls', label: 'TURN TLS', tier: 2, alternatives: [] },
];

describe('bounded capability scheduler', () => {
  it('tries fallback only after the first pair does not pass', async () => {
    const tried: string[] = [];
    const result = await scheduleCapabilityCategories(categories, (_category, pair) => {
      tried.push(pair.id);
      return Promise.resolve({
        outcome: pair.id.endsWith('-0') ? 'timeout' : 'pass',
        detail: 'terminal',
        activeMs: 1,
      });
    });
    expect(tried).toEqual(['pair-turn-udp-0', 'pair-turn-udp-1']);
    expect(result[0]!.outcome).toBe('pass');
    expect(result[1]!.outcome).toBe('not-configured');
  });
  it('does not try alternatives after a verified pass', async () => {
    const tried: string[] = [];
    await scheduleCapabilityCategories(categories, (_category, pair) => {
      tried.push(pair.id);
      return Promise.resolve({ outcome: 'pass' as const, detail: 'verified', activeMs: 1 });
    });
    expect(tried).toEqual(['pair-turn-udp-0']);
  });
  it('does not start a fallback after the category wall-clock budget expires', async () => {
    const tried: string[] = [];
    await scheduleCapabilityCategories(
      categories,
      (_category, pair) => {
        tried.push(pair.id);
        const until = Date.now() + 5;
        while (Date.now() < until) {
          // Deliberately consume the injected one-millisecond category budget.
        }
        return Promise.resolve({ outcome: 'timeout' as const, detail: 'deadline', activeMs: 5 });
      },
      1,
      1,
    );
    expect(tried).toEqual(['pair-turn-udp-0']);
  });

  it('times out a stalled first alternative and starts its fallback inside one category budget', async () => {
    const tried: string[] = [];
    const started = Date.now();
    const result = await scheduleCapabilityCategories(
      [categories[0]!],
      (_category, pair, _index, _budget, signal) =>
        new Promise((resolve) => {
          tried.push(pair.id);
          if (pair.id.endsWith('-0')) {
            signal.addEventListener(
              'abort',
              () =>
                resolve({
                  outcome: 'timeout',
                  detail: 'first endpoint timed out',
                  activeMs: Date.now() - started,
                }),
              { once: true },
            );
          } else resolve({ outcome: 'pass', detail: 'fallback passed', activeMs: 1 });
        }),
      1,
      120,
    );
    expect(tried).toEqual(['pair-turn-udp-0', 'pair-turn-udp-1']);
    expect(Date.now() - started).toBeLessThan(120);
    expect(result[0]?.outcome).toBe('pass');
  });

  it('lets the executor settle after its deadline signal instead of publishing a competing result', async () => {
    const result = await scheduleCapabilityCategories(
      [categories[0]!],
      (_category, pair, _index, _budget, signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () =>
              resolve({
                outcome: pair.id.endsWith('-0') ? 'timeout' : 'pass',
                detail: pair.id.endsWith('-0') ? 'ordinary endpoint timeout' : 'fallback passed',
                activeMs: 1,
              }),
            { once: true },
          );
        }),
      1,
      40,
    );
    expect(result[0]?.pairs.map((pair) => pair.outcome)).toEqual(['timeout', 'pass']);
    expect(result[0]?.outcome).toBe('pass');
  });

  it('does not start later alternatives or categories after cancellation', async () => {
    let cancelled = false;
    const tried: string[] = [];
    const result = await scheduleCapabilityCategories(
      categories,
      (_category, pair) => {
        tried.push(pair.id);
        cancelled = true;
        return Promise.resolve({ outcome: 'timeout', detail: 'stopped', activeMs: 1 });
      },
      1,
      30_000,
      () => cancelled,
    );
    expect(tried).toEqual(['pair-turn-udp-0']);
    expect(result.map((row) => row.outcome)).toEqual(['timeout', 'cancelled']);
  });

  it('aborts active work promptly and leaves queued categories unstarted on cancellation', async () => {
    let cancelled = false;
    const tried: string[] = [];
    const running = scheduleCapabilityCategories(
      categories,
      (_category, pair, _index, _budget, signal) =>
        new Promise((resolve) => {
          tried.push(pair.id);
          signal.addEventListener(
            'abort',
            () =>
              resolve({
                outcome: 'cancelled',
                detail: 'cancelled',
                activeMs: 1,
              }),
            { once: true },
          );
        }),
      1,
      30_000,
      () => cancelled,
    );
    cancelled = true;
    const result = await running;
    expect(tried).toEqual(['pair-turn-udp-0']);
    expect(result.map((row) => row.outcome)).toEqual(['cancelled', 'cancelled']);
  });

  it('uses its injected monotonic clock for category deadlines and elapsed time', async () => {
    let now = 0;
    const result = await scheduleCapabilityCategories(
      [categories[0]!],
      (_category, _pair, _index, remainingMs) => {
        now += remainingMs;
        return Promise.resolve({
          outcome: 'timeout',
          detail: 'clock advanced',
          activeMs: remainingMs,
        });
      },
      1,
      30,
      undefined,
      undefined,
      false,
      () => now,
    );
    expect(result[0]).toMatchObject({ activeMs: 30, outcome: 'timeout' });
  });
});
