// src/chat/tools/workspace-tools.ts
//
// Tool: lace_workspace_context — read project files to understand what the user is building.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { ToolResult } from '../types';
import { registerTool } from '../tool-registry';

// Files to look for (ordered by priority)
const CONTEXT_FILES = [
  'package.json',
  'go.mod',
  'requirements.txt',
  'pyproject.toml',
  'Cargo.toml',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  '.terraform-version',
  'terraform.tfvars',
  'main.tf',
  'variables.tf',
  'README.md',
  'README.rst',
  'README.txt',
];

const MAX_FILE_BYTES = 4096;

export function registerWorkspaceTools(): void {
  registerTool('lace_workspace_context', async (): Promise<ToolResult> => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return { content: 'No workspace folder is open.', isError: true };
    }

    const root = workspaceFolder.uri.fsPath;
    const lines: string[] = [];
    lines.push(`**Workspace:** ${path.basename(root)}`);
    lines.push('');

    // Top-level directory listing
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name + '/');
      const files = entries.filter((e) => e.isFile()).map((e) => e.name);
      lines.push('### Top-level structure');
      for (const d of dirs.slice(0, 30)) lines.push(`- ${d}`);
      for (const f of files.slice(0, 30)) lines.push(`- ${f}`);
      if (dirs.length + files.length > 60)
        lines.push(`- ... (${dirs.length + files.length} total entries)`);
      lines.push('');
    } catch {
      // Ignore directory listing errors
    }

    // Read context files
    const found: string[] = [];
    for (const filename of CONTEXT_FILES) {
      const filePath = path.join(root, filename);
      try {
        if (!fs.existsSync(filePath)) continue;
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;

        const content = fs.readFileSync(filePath, 'utf-8').slice(0, MAX_FILE_BYTES);
        const truncated = content.length >= MAX_FILE_BYTES ? ' (truncated)' : '';

        lines.push(`### ${filename}${truncated}`);
        lines.push('```');
        lines.push(content);
        lines.push('```');
        lines.push('');
        found.push(filename);
      } catch {
        // Skip unreadable files
      }

      // Limit total context
      if (found.length >= 5) break;
    }

    if (found.length === 0) {
      lines.push('No recognized project files found.');
    }

    return { content: lines.join('\n') };
  });
}
