function normalizedConcurrency(value: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  if (!Number.isFinite(value)) return itemCount;
  return Math.max(1, Math.min(itemCount, Math.floor(value)));
}

/**
 * Runs provider work with a deterministic upper bound while preserving the
 * input order in the returned results. The global request policy remains the
 * final authority; this pool prevents orchestrators from knowingly submitting
 * more simultaneous requests than the configured policy can admit.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = normalizedConcurrency(concurrency, items.length);
  if (limit === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

export async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  return mapWithConcurrency(items, concurrency, async (item, index) => {
    try {
      return { status: 'fulfilled', value: await worker(item, index) } as const;
    } catch (reason) {
      return { status: 'rejected', reason } as const;
    }
  });
}
