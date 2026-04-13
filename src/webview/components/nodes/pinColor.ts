// pinColor maps an HCL type string to a handle color, so inputs and outputs
// of the same type family render with a consistent hue — Blender-style.
// Keyed on the outermost type family only; compound types inherit their
// base family's color.
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

export function pinColor(type: string): PinColor {
  const t = (type || '').trim().toLowerCase();
  if (t === '' || t === 'any') return ANY;
  if (t === 'string') return STRING;
  if (t === 'number') return NUMBER;
  if (t === 'bool' || t === 'boolean') return BOOL;
  if (t.startsWith('list') || t.startsWith('set') || t.startsWith('tuple')) return LIST;
  if (t.startsWith('map')) return MAP;
  if (t.startsWith('object')) return OBJECT;
  return ANY;
}
