import type { DiagnosticCategory, Profile } from '../shared/domain.js';

export type PairTerminal = {
  outcome: 'pass' | 'inconclusive' | 'timeout' | 'unsupported' | 'cancelled' | 'failure';
  detail: string;
  selected?: string;
  activeMs: number;
  stopCategory?: boolean;
};
export type CategoryTerminal = {
  id: string;
  outcome: PairTerminal['outcome'] | 'not-configured';
  activeMs: number;
  pairs: Array<Profile & PairTerminal>;
};

/** Runs category rows concurrently while preserving ordered, one-at-a-time
 * endpoint fallback inside each category. */
export async function scheduleCapabilityCategories(
  categories: readonly DiagnosticCategory[],
  execute: (
    category: DiagnosticCategory,
    pair: Profile,
    index: number,
    remainingMs: number,
    signal: AbortSignal,
  ) => Promise<PairTerminal>,
  concurrency = 3,
  categoryDeadlineMs = 30_000,
  cancelled: () => boolean = () => false,
  onCategoryTerminal?: (result: CategoryTerminal) => void,
  stopCategoryOnDeadline = false,
  now: () => number = () => performance.now(),
): Promise<CategoryTerminal[]> {
  const results: CategoryTerminal[] = [];
  let next = 0;
  const run = async () => {
    for (;;) {
      if (cancelled()) return;
      const category = categories[next++];
      if (!category) return;
      const startedAt = now();
      if (!category.alternatives.length) {
        const result = {
          id: category.id,
          outcome: 'not-configured' as const,
          activeMs: 0,
          pairs: [],
        };
        results.push(result);
        onCategoryTerminal?.(result);
        continue;
      }
      const pairs: Array<Profile & PairTerminal> = [];
      const deadlineAt = startedAt + categoryDeadlineMs;
      for (const [index, pair] of category.alternatives.entries()) {
        if (cancelled()) break;
        const remainingMs = deadlineAt - now();
        if (remainingMs <= 0) break;
        const alternativesLeft = category.alternatives.length - index;
        // Reserve a small interval for reporting/synchronizing each remaining
        // alternative, then divide the usable category budget fairly.
        const synchronizationReserve = Math.min(
          1_000 * Math.max(0, alternativesLeft - 1),
          Math.floor(remainingMs / 3),
        );
        const allocatedMs = Math.max(
          1,
          Math.floor((remainingMs - synchronizationReserve) / alternativesLeft),
        );
        const controller = new AbortController();
        const cancellationPoll = setInterval(() => {
          if (cancelled()) controller.abort();
        }, 25);
        const timer = setTimeout(() => controller.abort(), allocatedMs);
        // The abort is a cooperative deadline signal. Await the executor's
        // synchronized terminal result instead of racing it with a second local
        // timeout result that the peer can never observe.
        let terminal: PairTerminal;
        try {
          terminal = await execute(category, pair, index, allocatedMs, controller.signal);
        } finally {
          clearTimeout(timer);
          clearInterval(cancellationPoll);
        }
        const settled =
          controller.signal.aborted && stopCategoryOnDeadline
            ? { ...terminal, stopCategory: true }
            : terminal;
        controller.abort();
        pairs.push({ ...pair, status: 'terminal', ...settled });
        if (settled.outcome === 'pass' || settled.outcome === 'cancelled' || settled.stopCategory)
          break;
      }
      const result = {
        id: category.id,
        activeMs: Math.max(0, Math.round(now() - startedAt)),
        outcome:
          pairs.find((pair) => pair.outcome === 'pass')?.outcome ??
          pairs.at(-1)?.outcome ??
          (cancelled() ? 'cancelled' : 'timeout'),
        pairs,
      };
      results.push(result);
      onCategoryTerminal?.(result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, categories.length) }, run));
  return categories.map(
    (category) =>
      results.find((result) => result.id === category.id) ?? {
        id: category.id,
        outcome: 'cancelled' as const,
        activeMs: 0,
        pairs: [],
      },
  );
}
