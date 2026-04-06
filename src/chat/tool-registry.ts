// src/chat/tool-registry.ts
//
// Maps tool names → handler functions. Each handler takes parsed params
// and returns a ToolResult.

import type { ToolResult } from './types';

export type ToolHandler = (params: Record<string, unknown>) => Promise<ToolResult>;

const handlers = new Map<string, ToolHandler>();

export function registerTool(name: string, handler: ToolHandler): void {
  if (handlers.has(name)) {
    // Log to console — avoids importing vscode here (unit tests don't mock it at module level)
    console.warn(`[lace] Warning: tool ${name} re-registered, previous handler replaced.`);
  }
  handlers.set(name, handler);
}

export function getToolHandler(name: string): ToolHandler | undefined {
  return handlers.get(name);
}

export function getRegisteredToolNames(): string[] {
  return [...handlers.keys()];
}
