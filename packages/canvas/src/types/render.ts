// Render-model types live in @lace/proto — single source of truth shared
// between the host extension (@lace/host) and the canvas webview (@lace/canvas).
// Re-exported here so existing canvas imports (`./types/render`) keep working.
export type {
  CanvasView,
  Diagnostic,
  EdgeConfig,
  GeneratePhase,
  HostToWebview,
  NodeConfig,
  NodePin,
  RenderEdge,
  RenderError,
  RenderGroup,
  RenderInput,
  RenderNode,
  RenderOutput,
  SettingsConfig,
  ViewportIntent,
} from '@lace/proto';
