// Shared types for the chat-sidebar subsystem.
// Re-exports types from @lace/host that chat tools need.

export type {
  CanvasView,
  Diagnostic,
  EdgeConfig,
  LaceTransport,
  NodeConfig,
  RegistryModule,
  RenderError,
  SettingsConfig,
} from '@lace/host';

export type ToolResult = {
  content: string;
  isError?: boolean;
};

import type { CanvasView, LaceTransport, RegistryModule } from '@lace/host';

/**
 * Dependencies injected into the chat tools and the ChatController.
 *
 * Unlike the old ChatParticipantDeps, there is no publishCanvasView:
 * tools never push canvas state anywhere. The Subscribe stream is the
 * single source of truth, and the ChatController maintains the latest
 * view by consuming that stream. Tools read the latest view via
 * getCanvasView — a pull-only interface, not push.
 */
export type ToolDeps = {
  getRpcClient: () => LaceTransport | null;
  getRegistryModules: () => RegistryModule[];
  getUserOrgs: () => Array<{ slug: string; name: string; role: string }>;
  getLaceDir: () => string | undefined;
  getCanvasView: () => CanvasView | null;
};
