/**
 * Extract the variable name from a handle ID of the form "in:<name>" or "out:<name>".
 * Returns null if the handle is missing or doesn't match the expected prefix.
 */
export function parseHandleId(
  handleId: string | null | undefined,
  prefix: 'in' | 'out',
): string | null {
  if (!handleId) return null;
  const marker = `${prefix}:`;
  if (!handleId.startsWith(marker)) return null;
  const name = handleId.slice(marker.length);
  return name.length > 0 ? name : null;
}
