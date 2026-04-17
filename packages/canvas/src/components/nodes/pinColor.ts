// pinColor maps a type family to a handle color, so inputs and outputs
// of the same type family render with a consistent hue — Blender-style.
//
// Colors reference design tokens via CSS variable names. React accepts
// `var(--…)` in inline style fields (`fill`, `background`, `borderColor`,
// etc.), so xyflow's Handle + our SVG pins pick the tokenised color up
// transparently.
//
// Palette is tuned to sit on the dark Lace canvas and stay legible
// against the primary accent. These are the only socket colors — do
// not add more families without discussing; too many hues become noise.

export type PinColor = {
  fill: string;
  stroke: string;
};

const STRING: PinColor = {
  fill: 'var(--lace-pin-string-fill)',
  stroke: 'var(--lace-pin-string-stroke)',
};
const NUMBER: PinColor = {
  fill: 'var(--lace-pin-number-fill)',
  stroke: 'var(--lace-pin-number-stroke)',
};
const BOOL: PinColor = {
  fill: 'var(--lace-pin-bool-fill)',
  stroke: 'var(--lace-pin-bool-stroke)',
};
const LIST: PinColor = {
  fill: 'var(--lace-pin-list-fill)',
  stroke: 'var(--lace-pin-list-stroke)',
};
const MAP: PinColor = {
  fill: 'var(--lace-pin-map-fill)',
  stroke: 'var(--lace-pin-map-stroke)',
};
const OBJECT: PinColor = {
  fill: 'var(--lace-pin-object-fill)',
  stroke: 'var(--lace-pin-object-stroke)',
};
const ANY: PinColor = {
  fill: 'var(--lace-pin-any-fill)',
  stroke: 'var(--lace-pin-any-stroke)',
};

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

/** Fallback pin color used when a pin's type family can't be matched.
 *  Exported so downstream fallbacks don't duplicate the literal. */
export const ANY_PIN_COLOR: PinColor = ANY;

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
