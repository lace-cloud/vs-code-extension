// Maps tool names → { schema, handler }. Schemas are co-located with
// handlers at registration time so adding a tool requires a single edit.

import type { ToolResult } from './types';

export type ToolHandler = (params: Record<string, unknown>) => Promise<ToolResult>;

/**
 * Structural shape of the tool schema the LLM sees. Mirrors
 * vscode.LanguageModelChatTool but stays vscode-free at this layer so
 * unit tests don't need the vscode module mock.
 */
export type ToolSchema = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type ToolRegistration = {
  schema: ToolSchema;
  handler: ToolHandler;
};

const registry = new Map<string, ToolRegistration>();

export function registerTool(schema: ToolSchema, handler: ToolHandler): void {
  if (registry.has(schema.name)) {
    console.warn(`[lace] Warning: tool ${schema.name} re-registered, previous handler replaced.`);
  }
  registry.set(schema.name, { schema, handler });
}

export function getToolHandler(name: string): ToolHandler | undefined {
  return registry.get(name)?.handler;
}

export function getRegisteredToolNames(): string[] {
  return [...registry.keys()];
}

export function getToolSchemas(): ToolSchema[] {
  return [...registry.values()].map((r) => r.schema);
}
