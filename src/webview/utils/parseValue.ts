// src/webview/utils/parseValue.ts

/** Parse a config value string into a typed primitive (boolean, number, or string). */
export function parseConfigValue(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
