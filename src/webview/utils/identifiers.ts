export function toTerraformIdentifier(s: string): string {
  const base = (s || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!base) {
    return 'module_x';
  }
  if (/^[a-zA-Z_]/.test(base)) {
    return base;
  }
  return `m_${base}`;
}

export function isValidTerraformIdentifier(s: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(s);
}

export function uniqueInstanceId(desired: string, existingIds: Set<string>): string {
  if (!existingIds.has(desired)) {
    return desired;
  }
  let n = 1;
  while (existingIds.has(`${desired}_${n}`)) {
    n++;
  }
  return `${desired}_${n}`;
}
