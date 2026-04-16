// @lace/proto — shared render-model POJOs, structural proto shapes, and
// proto→render converters. Proto message types are generated separately
// per package (host: gRPC-JS, canvas: browser + JSON codecs, proto: shared
// messages only) — see scripts/proto-gen.sh.
//
// The converters here accept structural aliases (see ./proto-shapes) so one
// set of converters handles all three generated outputs, sidestepping the
// nominal enum identity issue ts-proto's `export enum` introduces.

export * from './converters';
export * from './proto-shapes';
export * from './render';
