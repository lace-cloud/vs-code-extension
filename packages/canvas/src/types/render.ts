// Render-model types live in @lace/proto — single source of truth shared
// between the host extension (@lace/host) and the canvas webview (@lace/canvas).
// Re-exported here so existing canvas imports (`./types/render`) keep working.
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
} from '@lace/proto';
