// Shared types for the chat-sidebar subsystem.
// Re-exports types from @lace/host that chat tools need.

export type {
  LaceTransport,
  CanvasView,
  RenderError,
  NodeConfig,
  EdgeConfig,
  SettingsConfig,
  Diagnostic,
  RegistryModule,
} from '@lace/host';

export type ToolResult = {
  content: string;
  isError?: boolean;
};
