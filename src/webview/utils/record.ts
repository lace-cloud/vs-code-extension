export function mapRecord<V, U>(
  rec: Record<string, V>,
  fn: (v: V, key: string) => U,
): Record<string, U> {
  return Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, fn(v, k)]));
}

export function filterRecord<V>(
  rec: Record<string, V>,
  fn: (v: V, key: string) => boolean,
): Record<string, V> {
  return Object.fromEntries(Object.entries(rec).filter(([k, v]) => fn(v, k)));
}
