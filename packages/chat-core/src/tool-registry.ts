// Registry of tool schemas + handlers.
//
// Handlers are pure async functions: input object → ToolResult.
// Schemas are plain data. The registry itself is a tiny in-memory
// Map with no IDE coupling — every caller (VS Code adapter,
// JetBrains adapter, unit tests) constructs one and registers the
// tools their environment provides.
//
// Instance-per-session rather than a module singleton: a global
// registry would leak tool handlers between adapters in any future
// in-process multi-host scenario (e.g. testing), and buys nothing
// over explicit construction.

import type { ToolResult, ToolSchema } from './types';

export type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

export type ToolRegistration = {
  schema: ToolSchema;
  handler: ToolHandler;
};

export interface ToolRegistry {
  register(schema: ToolSchema, handler: ToolHandler): void;
  getHandler(name: string): ToolHandler | undefined;
  listSchemas(): ToolSchema[];
  listNames(): string[];
}

export function createToolRegistry(): ToolRegistry {
  const entries = new Map<string, ToolRegistration>();

  return {
    register(schema, handler) {
      entries.set(schema.name, { schema, handler });
    },

    getHandler(name) {
      return entries.get(name)?.handler;
    },

    listSchemas() {
      return [...entries.values()].map((e) => e.schema);
    },

    listNames() {
      return [...entries.keys()];
    },
  };
}
