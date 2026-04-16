// @lace/host — public API

export { ServerManager } from './server-manager';
export { LaceTransport, convertCanvasView } from './transport';
export { SubscribeHandler } from './subscribe';
export type { SubscribeCallbacks } from './subscribe';
export { spawnEngine } from './engine-process';

// Re-export the generated proto EngineEvent for consumers that need to
// type Subscribe stream events (proactivity watcher, etc.).
export type { EngineEvent } from './generated/service';
export { RpcError, classifyRpcError, handleRpcError, requireClient } from './rpc-errors';
export { buildWebviewHtml } from './webview-html';
export type { WebviewHtmlOptions } from './webview-html';
export type { RpcErrorCategory } from './rpc-errors';

export type {
  EngineHandshake,
  ServerState,
  CanvasView,
  RenderNode,
  RenderEdge,
  RenderError,
  RenderGroup,
  RenderInput,
  RenderOutput,
  NodePin,
  NodeConfig,
  EdgeConfig,
  SettingsConfig,
  Diagnostic,
  RegistryModule,
  HostToWebview,
  WebviewToHost,
  GeneratePhase,
} from './types';
