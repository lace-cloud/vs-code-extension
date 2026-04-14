/**
 * Find indices of items with duplicate keys (case-insensitive).
 * Returns a Set of all indices that participate in a duplicate group.
 */
export function findDuplicateIndices<T>(items: T[], keyFn: (item: T) => string): Set<number> {
  const seen = new Map<string, number>();
  const dupes = new Set<number>();
  items.forEach((item, i) => {
    const key = keyFn(item).trim().toLowerCase();
    if (!key) return;
    if (seen.has(key)) {
      dupes.add(i);
      dupes.add(seen.get(key)!);
    }
    seen.set(key, i);
  });
  return dupes;
}
