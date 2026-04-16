// @lace/proto — shared render-model POJOs + generated proto messages.
// Generated files (./generated) are rebuilt via `pnpm proto:gen` — do not hand-edit.
// Render types (./render) are the UI-facing POJO shapes produced by converters.
//
// Note: proto message interfaces and render interfaces share some names
// (CanvasView, RenderNode, etc.). Render types are re-exported here; proto
// messages stay accessible via `./generated/service` imports (each consumer
// already has a local ./generated/service copy with package-specific service
// stubs, and ts-proto emits nominally distinct enums per output — so proto
// messages are NOT re-exported from this index).
export * from './render';
