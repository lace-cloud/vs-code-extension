// @lace/canvas — public library API.
//
// Single barrel entry. v0.1.0 ships only this surface; internal file
// structure is not part of the contract. Consumers (canvas-stories,
// the VS Code webview entry, future portal/JetBrains shells) import
// from '@lace/canvas' — no deep paths.

export type { HostBridge } from './App';
// ── Root component ──
export { default as App } from './App';
// ── Components ──
export { default as AccordionSection } from './components/AccordionSection';
export { default as ActionBar } from './components/ActionBar';
export { default as ContextMenu } from './components/ContextMenu';
export type { ExternalPin, GroupNodeData } from './components/nodes/GroupNode';
// ── Node components ──
export { default as GroupNode } from './components/nodes/GroupNode';
export type { ModuleNodeData } from './components/nodes/ModuleNode';
export { default as ModuleNode } from './components/nodes/ModuleNode';
// ── Panels ──
export { default as EdgeInspectorPanel } from './components/panels/EdgeInspectorPanel';
export {
  default as EnvironmentsPanel,
  EnvironmentsContent,
} from './components/panels/EnvironmentsPanel';
export { default as LocalsPanel, LocalsContent } from './components/panels/LocalsPanel';
export { default as ModuleConfigPanel } from './components/panels/ModuleConfigPanel';
export { default as ProvidersPanel, ProvidersContent } from './components/panels/ProvidersPanel';
export {
  default as TerraformConfigPanel,
  TerraformConfigContent,
} from './components/panels/TerraformConfigPanel';
export { default as UnifiedSettingsPanel } from './components/panels/UnifiedSettingsPanel';
export { default as SlidePanel } from './components/SlidePanel';
export { default as Toast } from './components/Toast';
export { ValidationErrorBanner } from './components/ValidationErrorBanner';
// ── Engines (transport implementations of the CanvasEngine contract) ──
export { ConnectWebEngine } from './connect-web-engine';
// ── Engine contract ──
export type {
  CanvasEngine,
  EngineEvent,
  EngineEventListener,
  GenerateResult,
  GraphSummary,
  InputUpdate,
  LocalDef,
  OutputDefEntry,
  OutputExportDef,
  ProviderConfigDef,
  ProviderDef,
  VariableDef,
} from './engine';
export { PostMessageEngine } from './post-message-engine';
export type { CanvasContextValue, CanvasState } from './state/engine-context';
// ── State ──
export { CanvasContext, useCanvas, useEngine } from './state/engine-context';
// ── Render-model types (re-exported from @lace/proto via ./types/render) ──
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
} from './types/render';
