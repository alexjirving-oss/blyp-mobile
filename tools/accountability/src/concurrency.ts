export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  operation: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Concurrency limit must be a positive integer');
  }
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      const item = items[index];
      if (item === undefined) {
        throw new Error(`Missing item at index ${index}`);
      }
      results[index] = await operation(item, index);
    }
  };

  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, () =>
    worker(),
  );
  const settled = await Promise.allSettled(workers);
  const failures = settled.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} parallel operation(s) failed`);
  }
  return results;
}
