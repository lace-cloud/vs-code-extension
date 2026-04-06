// src/chat/tool-registry.ts
//
// Maps tool names → handler functions. Each handler takes parsed params
// and returns a ToolResult.

import * as vscode from 'vscode';
import type { ToolResult } from './types';

export type ToolHandler = (params: Record<string, unknown>) => Promise<ToolResult>;

const handlers = new Map<string, ToolHandler>();

let outputChannel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Lace Chat');
  }
  return outputChannel;
}

export function registerTool(name: string, handler: ToolHandler): void {
  if (handlers.has(name)) {
    getChannel().appendLine(`Warning: tool ${name} re-registered, previous handler replaced.`);
  }
  handlers.set(name, handler);
}

export function getToolHandler(name: string): ToolHandler | undefined {
  return handlers.get(name);
}

export function getRegisteredToolNames(): string[] {
  return [...handlers.keys()];
}
