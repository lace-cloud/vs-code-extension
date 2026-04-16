// @lace/canvas — React canvas UI + transport implementations.
// The VS Code webview bootstrap lives in ./index.tsx (rspack entry, side effects).
// Downstream consumers (Storybook, tests) import from here.

export type { HostBridge } from './App';
export { default as App } from './App';
export { ConnectWebEngine } from './connect-web-engine';
export type { CanvasEngine, EngineEvent, EngineEventListener } from './engine';
export { PostMessageEngine } from './post-message-engine';
export type { CanvasState } from './state/engine-context';
