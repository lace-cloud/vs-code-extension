// @lace/design-tokens — JS/TS token exports
// Primary distribution is tokens.css; use this for JS/TS consumers that
// need programmatic access to token values (e.g., pinColor.ts).

export const brand = {
  green: '#CEFE65',
  greenBright: '#e0ff8a',
  gunmetal: '#153238',
  gunmetalLight: '#1a3f47',
  night: '#161616',
  cyan: '#95E7FF',
  grey: '#ECEFED',
} as const;

export const pin = {
  string: { fill: '#95E7FF', stroke: '#2C9DB9' },
  number: { fill: '#F5A623', stroke: '#8A5A10' },
  bool: { fill: '#B084F0', stroke: '#5C3E9A' },
  list: { fill: '#CEFE65', stroke: '#5E8A1A' },
  map: { fill: '#F288C6', stroke: '#8A2E5C' },
  object: { fill: '#FF8A4C', stroke: '#8A3A10' },
  any: { fill: '#9BA19E', stroke: '#4A4F4C' },
} as const;

export const ui = {
  btnPrimary: '#1f6feb',
  btnPrimaryDim: '#1a4d8f',
  btnSuccess: '#1a7f37',
  btnSuccessHover: '#3ab653',
  btnDangerBg: '#6e2b2b',
  textDanger: '#e5484d',
  textDangerLight: '#f87171',
  bgSurface: '#1e1e1e',
  bgSurfaceAlt: '#252526',
  bgInput: '#0f0f0f',
  borderDefault: '#333333',
  borderInput: '#555555',
  borderSubtle: '#3c3c3c',
} as const;
