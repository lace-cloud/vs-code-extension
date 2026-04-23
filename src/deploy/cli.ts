// Thin shell wrapper around the `lace` CLI for Deploy-panel operations.
// The extension does not maintain its own control-plane API client;
// instead it reuses the CLI's existing auth + HTTP layer via subprocess
// calls with `--output json`. This keeps auth centralized in the CLI
// (tokens, org/team context, refresh) and avoids duplicating the API
// surface in the extension.

import { type ChildProcess, spawn } from 'node:child_process';
import * as vscode from 'vscode';

export type Stack = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  orgId: string;
  teamId: string;
  connectionId: string;
  createdAt: string;
};

export type Run = {
  id: string;
  stackId: string;
  kind: string;
  status: string;
  bundleSnapshotId: string;
  initiatedByUserId: string;
  initiatedVia: string;
  planResourceAdd?: number;
  planResourceChange?: number;
  planResourceDestroy?: number;
  changeRequestId?: string | null;
  startedAt: string;
  completedAt?: string | null;
  errorMessage?: string | null;
};

function getBinaryPath(): string {
  return vscode.workspace.getConfiguration('lace').get<string>('binaryPath', 'lace');
}

/**
 * Run `lace ...args` and return parsed JSON stdout. Non-zero exit
 * throws with the stderr as message.
 */
async function runCliJson<T>(args: string[]): Promise<T> {
  const bin = getBinaryPath();
  return new Promise<T>((resolve, reject) => {
    const p = spawn(bin, [...args, '--output', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    p.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `lace ${args.join(' ')} exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch (err) {
        reject(new Error(`Failed to parse CLI JSON output: ${(err as Error).message}`));
      }
    });
  });
}

export async function listStacks(): Promise<Stack[]> {
  const res = await runCliJson<{ stacks?: Stack[] } | Stack[]>(['stack', 'list']);
  if (Array.isArray(res)) return res;
  return res.stacks ?? [];
}

export async function listRuns(stackId: string, limit = 10): Promise<Run[]> {
  const res = await runCliJson<{ runs?: Run[] } | Run[]>([
    'run',
    'list',
    '--stack',
    stackId,
    '--limit',
    String(limit),
  ]);
  if (Array.isArray(res)) return res;
  return res.runs ?? [];
}

export async function getRun(runId: string): Promise<Run> {
  return runCliJson<Run>(['run', 'get', runId]);
}

/**
 * Spawn `lace run apply <stack>` in a VS Code Terminal. The terminal
 * surfaces progress (plan, policy evaluation, run creation) directly
 * to the user; terminal remains open for them to inspect output.
 * Returns the terminal handle so callers can watch for exit.
 */
export function spawnApply(stackId: string, cwd: string): vscode.Terminal {
  const bin = getBinaryPath();
  const terminal = vscode.window.createTerminal({
    name: `Lace: apply ${stackId.slice(0, 12)}`,
    cwd,
  });
  terminal.show();
  terminal.sendText(`${quote(bin)} run apply ${quote(stackId)}`);
  return terminal;
}

/**
 * Spawn `lace run logs --follow <runId>` as a background process and
 * pipe its stdout/stderr lines to the provided OutputChannel.
 * Returns a disposable that stops the stream.
 */
export function streamRunLogs(
  runId: string,
  channel: vscode.OutputChannel,
): { dispose: () => void; process: ChildProcess } {
  const bin = getBinaryPath();
  const proc = spawn(bin, ['run', 'logs', '--follow', runId], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', (d: Buffer) => channel.append(d.toString()));
  proc.stderr?.on('data', (d: Buffer) => channel.append(d.toString()));
  proc.on('close', (code) => {
    channel.appendLine(`\n[stream ended, exit=${code}]`);
  });
  return {
    process: proc,
    dispose: () => {
      if (!proc.killed) proc.kill('SIGTERM');
    },
  };
}

function quote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export const TERMINAL_RUN_STATUSES = new Set([
  'apply_succeeded',
  'apply_failed',
  'plan_failed',
  'policy_blocked',
  'cancelled',
  'rejected',
]);

export function isTerminal(status: string): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}
