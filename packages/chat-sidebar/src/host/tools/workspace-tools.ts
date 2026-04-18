// src/chat/tools/workspace-tools.ts
//
// Tool: lace_workspace_context — read project files and build a structured
// ProjectProfile to help the model understand what the user is building.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolRegistry, ToolResult } from '@lace-cloud/chat-core';
import * as vscode from 'vscode';

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
const MAX_CONTEXT_FILES = 8;

// ── Project Profile ──

type ProjectProfile = {
  languages: string[];
  frameworks: string[];
  runtimes: string[];
  databases: string[];
  cloud_hints: string[];
  existing_modules: string[];
};

function detectLanguages(found: Set<string>): string[] {
  const langs: string[] = [];
  if (found.has('package.json')) langs.push('typescript/javascript');
  if (found.has('go.mod')) langs.push('go');
  if (found.has('requirements.txt') || found.has('pyproject.toml')) langs.push('python');
  if (found.has('Cargo.toml')) langs.push('rust');
  if (found.has('Gemfile')) langs.push('ruby');
  if (found.has('pom.xml') || found.has('build.gradle')) langs.push('java');
  return langs;
}

function detectFrameworks(fileContents: Map<string, string>): string[] {
  const frameworks: string[] = [];
  const pkg = fileContents.get('package.json');
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg);
      const deps = { ...parsed.dependencies, ...parsed.devDependencies };
      if (deps.express) frameworks.push('express');
      if (deps.fastify) frameworks.push('fastify');
      if (deps.next) frameworks.push('next.js');
      if (deps.react && !deps.next) frameworks.push('react');
      if (deps.vue) frameworks.push('vue');
      if (deps['@nestjs/core']) frameworks.push('nestjs');
      if (deps.hono) frameworks.push('hono');
    } catch {
      /* malformed package.json */
    }
  }
  const reqs = fileContents.get('requirements.txt') ?? '';
  const pyproject = fileContents.get('pyproject.toml') ?? '';
  const pyAll = reqs + pyproject;
  if (/django/i.test(pyAll)) frameworks.push('django');
  if (/flask/i.test(pyAll)) frameworks.push('flask');
  if (/fastapi/i.test(pyAll)) frameworks.push('fastapi');

  const gomod = fileContents.get('go.mod') ?? '';
  if (/gin-gonic/i.test(gomod)) frameworks.push('gin');
  if (/gorilla\/mux/i.test(gomod)) frameworks.push('gorilla/mux');
  if (/fiber/i.test(gomod)) frameworks.push('fiber');

  return frameworks;
}

function detectRuntimes(fileContents: Map<string, string>): string[] {
  const runtimes: string[] = [];
  const dockerfile = fileContents.get('Dockerfile') ?? fileContents.get('docker-compose.yml') ?? '';
  const fromMatch = dockerfile.match(/^FROM\s+(\S+)/m);
  if (fromMatch) runtimes.push(fromMatch[1]);

  const pkg = fileContents.get('package.json');
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg);
      if (parsed.engines?.node) runtimes.push(`node:${parsed.engines.node}`);
    } catch {
      /* skip */
    }
  }
  return runtimes;
}

function detectDatabases(fileContents: Map<string, string>): string[] {
  const dbs: string[] = [];
  const allContent = [...fileContents.values()].join('\n').toLowerCase();
  if (/postgres|pg|psycopg/i.test(allContent)) dbs.push('postgres');
  if (/mysql|mariadb/i.test(allContent)) dbs.push('mysql');
  if (/mongodb|mongoose/i.test(allContent)) dbs.push('mongodb');
  if (/redis|ioredis/i.test(allContent)) dbs.push('redis');
  if (/dynamodb|@aws-sdk\/client-dynamodb/i.test(allContent)) dbs.push('dynamodb');
  return [...new Set(dbs)];
}

function detectCloudHints(fileContents: Map<string, string>): string[] {
  const hints: string[] = [];
  const allContent = [...fileContents.values()].join('\n');
  if (/aws-sdk|@aws-sdk|amazonaws\.com|aws_/i.test(allContent)) hints.push('aws');
  if (/azure|@azure\//i.test(allContent)) hints.push('azure');
  if (/google-cloud|@google-cloud\//i.test(allContent)) hints.push('google');
  return [...new Set(hints)];
}

function detectExistingModules(root: string): string[] {
  const laceDir = path.join(root, '.lace');
  const modules: string[] = [];
  try {
    const mainTf = fs.readFileSync(path.join(laceDir, 'main.tf'), 'utf-8');
    const matches = mainTf.matchAll(/source\s*=\s*"([^"]+)"/g);
    for (const m of matches) {
      modules.push(m[1]);
    }
  } catch {
    /* no generated terraform yet */
  }
  return modules;
}

function buildProjectProfile(
  root: string,
  found: Set<string>,
  fileContents: Map<string, string>,
): ProjectProfile {
  return {
    languages: detectLanguages(found),
    frameworks: detectFrameworks(fileContents),
    runtimes: detectRuntimes(fileContents),
    databases: detectDatabases(fileContents),
    cloud_hints: detectCloudHints(fileContents),
    existing_modules: detectExistingModules(root),
  };
}

// ── Tool Registration ──

export function registerWorkspaceTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: 'lace_workspace_context',
      description: "Read the user's project files to understand what they are building.",
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    async (): Promise<ToolResult> => {
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
          .map((e) => `${e.name}/`);
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

      // Read project context files
      const found = new Set<string>();
      const fileContents = new Map<string, string>();

      for (const filename of CONTEXT_FILES) {
        const filePath = path.join(root, filename);
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          const truncated = raw.length > MAX_FILE_BYTES;
          const content = truncated ? raw.slice(0, MAX_FILE_BYTES) : raw;
          found.add(filename);
          fileContents.set(filename, content);
        } catch {
          // File does not exist or is not readable — skip
        }

        if (found.size >= MAX_CONTEXT_FILES) break;
      }

      // Build and prepend structured project profile
      const profile = buildProjectProfile(root, found, fileContents);
      lines.push('### Project Profile');
      lines.push('```json');
      lines.push(JSON.stringify(profile, null, 2));
      lines.push('```');
      lines.push('');

      // Include raw file contents as context
      for (const [filename, content] of fileContents) {
        const truncated = content.length >= MAX_FILE_BYTES;
        lines.push(`### ${filename}${truncated ? ' (truncated at 4096 bytes)' : ''}`);
        lines.push('```');
        lines.push(content);
        lines.push('```');
        lines.push('');
      }

      // Read existing generated Terraform from .lace/
      const laceDir = path.join(root, '.lace');
      try {
        const laceEntries = fs.readdirSync(laceDir, { withFileTypes: true });
        const tfFiles = laceEntries.filter((e) => e.isFile() && e.name.endsWith('.tf')).slice(0, 3);

        if (tfFiles.length > 0) {
          lines.push('### Existing generated Terraform (.lace/)');
          for (const entry of tfFiles) {
            const filePath = path.join(laceDir, entry.name);
            try {
              const raw = fs.readFileSync(filePath, 'utf-8');
              const truncated = raw.length > MAX_FILE_BYTES;
              const content = truncated ? raw.slice(0, MAX_FILE_BYTES) : raw;
              lines.push(`#### ${entry.name}${truncated ? ' (truncated)' : ''}`);
              lines.push('```hcl');
              lines.push(content);
              lines.push('```');
              lines.push('');
            } catch {
              // Skip unreadable .lace tf files
            }
          }
        }
      } catch {
        // .lace dir doesn't exist yet — that's fine
      }

      if (found.size === 0) {
        lines.push('No recognized project files found.');
      }

      return { content: lines.join('\n') };
    },
  );
}
