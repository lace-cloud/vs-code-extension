// src/chat/tool-registry.ts
//
// Maps tool names → handler functions. Each handler takes parsed params
// and returns a ToolResult.

import type { ToolResult } from './types';

export type ToolHandler = (params: Record<string, unknown>) => Promise<ToolResult>;

const handlers = new Map<string, ToolHandler>();

export function registerTool(name: string, handler: ToolHandler): void {
  handlers.set(name, handler);
}

export function getToolHandler(name: string): ToolHandler | undefined {
  return handlers.get(name);
}

export function getRegisteredToolNames(): string[] {
  return [...handlers.keys()];
}
