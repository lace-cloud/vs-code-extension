// @lace/host — public API

export { convertCanvasView } from '@lace/proto';
export { spawnEngine } from './engine-process';
// Re-export the generated proto EngineEvent for consumers that need to
// type Subscribe stream events (proactivity watcher, etc.).
export type { EngineEvent } from './generated/service';
export type { RpcErrorCategory } from './rpc-errors';
export { classifyRpcError, handleRpcError, RpcError, requireClient } from './rpc-errors';
export { ServerManager } from './server-manager';
export type { SubscribeCallbacks } from './subscribe';
export { SubscribeHandler } from './subscribe';
export { LaceTransport } from './transport';
export type {
  CanvasView,
  Diagnostic,
  EdgeConfig,
  EngineHandshake,
  GeneratePhase,
  HostToWebview,
  NodeConfig,
  NodePin,
  RegistryModule,
  RenderEdge,
  RenderError,
  RenderGroup,
  RenderInput,
  RenderNode,
  RenderOutput,
  ServerState,
  SettingsConfig,
  WebviewToHost,
} from './types';
export type { WebviewHtmlOptions } from './webview-html';
export { buildWebviewHtml } from './webview-html';
