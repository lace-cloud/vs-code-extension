// What the window tests share: the extension as its activation hands it
// back, module directories made in the workspace's repository, the canvas
// tabs, and waiting for what the window does.
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CanvasSource, EditorPort } from '@lace-cloud/canvas/engine';
import { InputMode } from '@lace-cloud/canvas/engine';
import * as vscode from 'vscode';
import type { RootHold, RootSession } from '../../../src/engine/root-sessions';
import type { LaceExtension } from '../../../src/extension';

export const EXTENSION = 'LaceCloudInc.lace-cloud';

// The engine the window runs, as `.vscode-test.mjs` named it.
export const ENGINE = process.env.LACE_E2E_ENGINE ?? '';

export async function lace(): Promise<LaceExtension> {
  const extension = vscode.extensions.getExtension<LaceExtension>(EXTENSION);
  assert.ok(extension, `the extension ${EXTENSION} is not loaded`);
  return extension.isActive ? extension.exports : extension.activate();
}

export function workspace(): string {
  const [folder] = vscode.workspace.workspaceFolders ?? [];
  assert.ok(folder, 'the window has no workspace folder');
  return folder.uri.fsPath;
}

export function git(...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=lace host e2e', '-c', 'user.email=host-e2e@lace.test', ...args],
    { cwd: workspace(), encoding: 'utf8' },
  );
}

export type Module = {
  name: string;
  path: string;
  uri: vscode.Uri;
  file: (name: string) => string;
};

let made = 0;

// A module directory of its own in the workspace's repository holding
// `files` (name → content), committed.
export function moduleDirectory(files: Record<string, string>): Module {
  made += 1;
  const name = `module-${made}`;
  const path = join(workspace(), name);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(path, file)), { recursive: true });
    writeFileSync(join(path, file), content);
  }
  git('add', '--', name);
  git('commit', '--quiet', '-m', `host e2e: ${name}`, '--', name);
  return { name, path, uri: vscode.Uri.file(path), file: (file) => join(path, file) };
}

// The Terraform files of `module` that differ from what was committed.
export function changedTerraform(module: Module): string[] {
  return git('status', '--porcelain', '--', module.name)
    .split('\n')
    .map((line) => line.slice(3))
    .filter((file) => file.endsWith('.tf'));
}

// A module calling one child module with one input, `name`, set to
// `first`.
export const COMPOSED: Record<string, string> = {
  'main.tf': 'module "app" {\n  source = "./app"\n  name   = "first"\n}\n',
  'app/main.tf':
    'variable "name" {\n  type = string\n}\n\noutput "name" {\n  value = var.name\n}\n',
};

export async function until(
  what: string,
  holds: () => boolean | Promise<boolean>,
  withinMs = 30_000,
): Promise<void> {
  const started = Date.now();
  while (!(await holds())) {
    if (Date.now() - started > withinMs)
      throw new Error(`${what} did not happen in ${withinMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// Runs the command `id` to its end, closing each notification it shows: a
// notice with actions waits for an answer, and a closed one answers none.
export async function settle(id: string, ...args: unknown[]): Promise<void> {
  let done = false;
  const running = vscode.commands.executeCommand(id, ...args).then(
    () => {
      done = true;
    },
    (error: unknown) => {
      done = true;
      throw error;
    },
  );
  while (!done) {
    await vscode.commands.executeCommand('notifications.clearAll');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await running;
}

export function canvasTabs(module?: Module): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        tab.input instanceof vscode.TabInputWebview &&
        tab.input.viewType.endsWith('lace.canvas') &&
        (module === undefined || tab.label.replace(/ ●$/, '') === module.name),
    );
}

export async function openCanvas(module: Module): Promise<vscode.Tab> {
  await vscode.commands.executeCommand('lace.openCanvas', module.uri);
  await until(`the canvas of ${module.name} to open`, () => canvasTabs(module).length === 1);
  return canvasTabs(module)[0];
}

export async function closeCanvas(module: Module): Promise<void> {
  await vscode.window.tabGroups.close(canvasTabs(module));
}

export async function heldSession(module: Module): Promise<RootSession | undefined> {
  const { rootSessions } = await lace();
  return rootSessions.held().find((session) => session.root === module.path);
}

// The frame a session's source publishes now.
export function frameOf(hold: Pick<RootHold, 'ports'>): CanvasSource {
  let frame: CanvasSource | undefined;
  hold.ports.source.subscribe(
    (next) => {
      frame = next;
    },
    () => {},
  )();
  assert.ok(frame, 'the session has published no frame');
  return frame;
}

// `module`'s child `app` given `value` for its input `name`, through a hold
// of the test's own: another client of the root's session.
export async function setName(module: Module, value: string): Promise<void> {
  const { rootSessions } = await lace();
  const hold = await rootSessions.acquire(module.path);
  try {
    const editor = hold.ports.editor as EditorPort;
    const result = await editor.apply([
      {
        update_input: {
          scope: frameOf(hold).bundle.entry,
          instance_id: 'app',
          input_name: 'name',
          mode: InputMode.INPUT_MODE_LITERAL,
          value,
          variable: '',
          expression: '',
        },
      },
    ]);
    assert.equal(result.success, true, JSON.stringify(result.errors));
  } finally {
    await hold.release();
  }
}

// The frame the session of `module` publishes now, through a hold of the
// test's own: the session the canvas holds, or the one the root opens on.
export async function sessionFrame(module: Module): Promise<CanvasSource> {
  const { rootSessions } = await lace();
  const hold = await rootSessions.acquire(module.path);
  try {
    return frameOf(hold);
  } finally {
    await hold.release();
  }
}

// Whether the session of `module` holds `value` anywhere in its IR.
export async function sessionHolds(module: Module, value: string): Promise<boolean> {
  return JSON.stringify((await sessionFrame(module)).bundle).includes(value);
}

export async function setting(section: string, key: string, value: unknown): Promise<void> {
  await vscode.workspace
    .getConfiguration(section)
    .update(key, value, vscode.ConfigurationTarget.Workspace);
}
