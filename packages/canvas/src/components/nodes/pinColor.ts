// pinColor maps a type family to a handle color, so inputs and outputs
// of the same type family render with a consistent hue — Blender-style.
//
// Palette is tuned to sit on the dark Lace canvas (#161616) and stay legible
// against the primary accent (#CEFE65). These are the only socket colors —
// do not add more families without discussing; too many hues becomes noise.

export type PinColor = {
  fill: string;
  stroke: string;
};

const STRING: PinColor = { fill: '#95E7FF', stroke: '#2C9DB9' }; // cyan
const NUMBER: PinColor = { fill: '#F5A623', stroke: '#8A5A10' }; // amber
const BOOL: PinColor = { fill: '#B084F0', stroke: '#5C3E9A' }; // purple
const LIST: PinColor = { fill: '#CEFE65', stroke: '#5E8A1A' }; // lace-green
const MAP: PinColor = { fill: '#F288C6', stroke: '#8A2E5C' }; // pink
const OBJECT: PinColor = { fill: '#FF8A4C', stroke: '#8A3A10' }; // orange
const ANY: PinColor = { fill: '#9BA19E', stroke: '#4A4F4C' }; // grey

const FAMILY_COLORS: Record<string, PinColor> = {
  string: STRING,
  number: NUMBER,
  bool: BOOL,
  boolean: BOOL,
  list: LIST,
  set: LIST,
  tuple: LIST,
  map: MAP,
  object: OBJECT,
  any: ANY,
};

/**
 * Infer type family from a raw HCL type string (fallback for when CLI
 * doesn't yet send type_family on NodePin).
 */
function inferTypeFamily(type: string): string {
  const t = (type || '').trim().toLowerCase();
  if (t === '' || t === 'any') return 'any';
  // Check for compound types like "list(string)", "map(object({...}))"
  for (const family of ['list', 'set', 'tuple', 'map', 'object']) {
    if (t.startsWith(family)) return family;
  }
  return t; // "string", "number", "bool" fall through as-is
}

/**
 * Get the pin color for a NodePin. Prefers `type_family` if provided (from CLI),
 * falls back to inferring from the raw HCL type string.
 */
export function pinColor(pin: { type: string; type_family?: string }): PinColor {
  const family = pin.type_family ?? inferTypeFamily(pin.type);
  return FAMILY_COLORS[family] ?? ANY;
}
