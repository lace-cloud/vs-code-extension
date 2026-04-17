// @lace/host — public library API.
//
// Vscode-free barrel. The vscode-coupled extension shell (panel
// classes, webview-html builder, RPC-error toast-shower) lives in
// vs-code-extension/src/vscode/, not here. Consumers (canvas, chat-
// core, future portal/JetBrains adapters) import only what they
// need at runtime — vscode is never loaded as a side-effect.

export { convertCanvasView } from '@lace/proto';
export { spawnEngine } from './engine-process';
// Re-export the generated proto EngineEvent for consumers that need to
// type Subscribe stream events (proactivity watcher, etc.).
export type { EngineEvent } from './generated/service';
export type { RpcErrorCategory } from './rpc-errors';
export { classifyRpcError, RpcError, requireClient } from './rpc-errors';
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
