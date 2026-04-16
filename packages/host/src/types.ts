// @lace/host — extension-host-specific types.
// Render-model types (CanvasView, RenderNode, etc.) come from @lace/proto —
// single source of truth shared with the canvas package.

export type {
  CanvasView,
  RenderGroup,
  RenderNode,
  NodePin,
  RenderEdge,
  RenderInput,
  RenderOutput,
  NodeConfig,
  EdgeConfig,
  SettingsConfig,
  RenderError,
  Diagnostic,
  GeneratePhase,
  HostToWebview,
  ViewportIntent,
} from '@lace/proto';

// ── Engine handshake ──

export type EngineHandshake = {
  version: string;
  protocolVersion: string;
  port: number;
  token: string;
};

export type ServerState = 'stopped' | 'starting' | 'running' | 'error';

// ── Webview → host protocol (host-only; canvas has its own producer side) ──

export type WebviewToHost =
  | { command: 'webviewReady' }
  | { command: 'engineCall'; requestId: string; method: string; params?: unknown }
  | { command: 'markDirty' }
  | { command: 'markClean' }
  | { command: 'openChat'; prompt: string }
  | { command: 'openFile'; relativePath: string; line?: number; column?: number };

// ── Domain types ──

export type RegistryModule = {
  id: string;
  name: string;
  system: string;
  version: string;
  categories?: string[];
  description?: string;
  icon_url?: string;
};
