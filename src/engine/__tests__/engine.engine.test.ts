// The engine and the root sessions against the real engine, the `lace` CLI
// in bin/ or on PATH (`real-engine.ts`).
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectError, Reason } from '@lace-cloud/canvas/engine';
import { ENGINE_PROTOCOL_VERSION } from '@lace-cloud/proto';
import { describe, expect, test } from 'vitest';
import { createAutosaveKeeper } from '../../autosave/autosave-policy';
import { EngineStartError } from '../engine';
import { afterTest, BINARY, moduleDirectory, realEngine, until } from './real-engine';

const STAND_IN = join(__dirname, 'host-stand-in.mjs');

// The time VS Code gives `deactivate` before it ends the extension host.
const DEACTIVATION_BUDGET_MS = 4500;

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// The engine processes this test process started.
const engineProcesses = (): number[] =>
  execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line !== '')
    .map(Number)
    .filter((pid) =>
      execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).includes(
        BINARY,
      ),
    );

const EDIT = [{ set_variables: { variables: [] } }];

describe('root sessions on the real engine', () => {
  test('two spellings of one directory are one session', async () => {
    const { repository, root } = moduleDirectory();
    symlinkSync(root, join(repository, 'link'));
    const { rootSessions } = realEngine();

    const real = await rootSessions.acquire(root);
    const link = await rootSessions.acquire(join(repository, 'link'));

    expect(link.sessionId).toBe(real.sessionId);
    expect(rootSessions.held()).toHaveLength(1);
    expect(rootSessions.held()[0].holders).toBe(2);
  });

  test('an edit made under a short hold stays, unsaved, while another holder keeps the session', async () => {
    const { root } = moduleDirectory();
    const { rootSessions } = realEngine();
    const canvas = await rootSessions.acquire(root);
    let unsaved = false;
    canvas.ports.source.subscribe(
      (frame) => {
        unsaved = frame.unsaved;
      },
      () => {},
    );

    const edit = await rootSessions.acquire(root);
    const applied = await edit.ports.editor.apply(EDIT);
    await edit.release();

    expect(applied.success).toBe(true);
    await until('the unsaved frame', () => unsaved);
    expect(rootSessions.held()).toMatchObject([{ sessionId: canvas.sessionId, holders: 1 }]);
  });

  test('the last release closes the session: its unsaved edit is gone and the root opens as a new session', async () => {
    const { root } = moduleDirectory();
    const { rootSessions, reports } = realEngine();
    const first = await rootSessions.acquire(root);
    const id = first.sessionId;
    await first.ports.editor.apply(EDIT);
    await first.release();

    const second = await rootSessions.acquire(root);
    let unsaved: boolean | undefined;
    second.ports.source.subscribe(
      (frame) => {
        unsaved = frame.unsaved;
      },
      () => {},
    );

    expect(second.sessionId).not.toBe(id);
    expect(unsaved).toBe(false);
    expect(reports).toEqual([]);
  });

  test('a root another engine holds is refused with its reason', async () => {
    const { root } = moduleDirectory();
    const first = realEngine();
    await first.rootSessions.acquire(root);

    const refused = await realEngine()
      .rootSessions.acquire(root)
      .catch((error) => error);
    expect(refused).toBeInstanceOf(ConnectError);
    expect(refused.reason).toBe(Reason.REASON_ROOT_LOCKED);
  });

  test('after the engine is killed and restarts, a holder is on the new session and a short hold does not close it', async () => {
    const { root } = moduleDirectory();
    const { rootSessions } = realEngine({ autoRestart: true });
    const canvas = await rootSessions.acquire(root);
    const stale = canvas.sessionId;
    let renewals = 0;
    canvas.renewed(() => {
      renewals += 1;
    });

    const [enginePid] = engineProcesses();
    process.kill(enginePid, 'SIGKILL');
    // The stream fails before the manager has seen the exit, so the first
    // attempt to open the root again can reach the dead engine and be
    // refused; the one over the restarted engine names the new session.
    await until('the hold being on a new session', () => canvas.sessionId !== stale);
    expect(renewals).toBeGreaterThanOrEqual(1);

    const edit = await rootSessions.acquire(root);
    expect(edit.sessionId).toBe(canvas.sessionId);
    await edit.ports.editor.apply(EDIT);
    await edit.release();

    let unsaved = false;
    canvas.ports.source.subscribe(
      (frame) => {
        unsaved = frame.unsaved;
      },
      () => {},
    );
    await until('the unsaved frame', () => unsaved);
    expect(rootSessions.held()).toMatchObject([{ sessionId: canvas.sessionId, holders: 1 }]);
  });
});

describe('the engine does not outlive its host', () => {
  test('a host killed with SIGKILL leaves no engine, and a new host opens the same root', async () => {
    const { root } = moduleDirectory();
    const host = spawn(process.execPath, [STAND_IN, BINARY, root], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    afterTest(() => {
      host.kill('SIGKILL');
    });
    const { enginePid } = await new Promise<{ enginePid: number }>((resolvePid, reject) => {
      host.stdout.once('data', (line: Buffer) => resolvePid(JSON.parse(line.toString())));
      host.once('exit', (code) => reject(new Error(`the stand-in exited with ${code}`)));
    });
    expect(alive(enginePid)).toBe(true);

    host.kill('SIGKILL');
    const tookMs = await until('the engine exiting', () => !alive(enginePid));
    console.info(`engine exited ${tookMs} ms after its host was killed`);

    const hold = await realEngine().rootSessions.acquire(root);
    expect(hold.sessionId).not.toBe('');
  });
});

// The canvas state the engine keeps for `root`: it writes one when a session
// first opens on the root, and each save rewrites it.
const canvasState = (root: string): Buffer =>
  readFileSync(join(root, '.lace', '.canvas', 'state.lace'));

describe('the window closing', () => {
  // An autosave keeper under `onWindowChange`, which saves on no timer and
  // no page blur: only a close or the window closing saves an edit. What it
  // writes to the Output channel and shows as a notification is kept.
  function keeper() {
    const log: string[] = [];
    const shown: string[] = [];
    const attached = createAutosaveKeeper(
      {
        workspace: {
          getConfiguration: () => ({
            get: (key: string) => (key === 'autoSave' ? 'onWindowChange' : undefined),
          }),
          onDidChangeConfiguration: () => ({ dispose: () => {} }),
          asRelativePath: (path: string) => path,
        },
        window: {
          onDidChangeWindowState: () => ({ dispose: () => {} }),
          showErrorMessage: async (message: string) => {
            shown.push(message);
            return undefined;
          },
        },
        Uri: { file: (path: string) => ({ fsPath: path }) },
      } as never,
      (line) => log.push(line),
    );
    return { attach: attached.attach, log, shown };
  }

  test('an unsaved edit is saved and the engine is gone inside the deactivation budget', async () => {
    const { root } = moduleDirectory();
    const { engine, rootSessions, reports } = realEngine({ observer: keeper().attach });
    const hold = await rootSessions.acquire(root);
    const opened = canvasState(root);
    let unsaved = false;
    hold.ports.source.subscribe(
      (frame) => {
        unsaved = frame.unsaved;
      },
      () => {},
    );
    await hold.ports.editor.apply(EDIT);
    await until('the unsaved frame', () => unsaved);
    const [enginePid] = engineProcesses();

    const started = Date.now();
    await rootSessions.dispose();
    const flushedMs = Date.now() - started;
    await engine.stop();
    const stoppedMs = Date.now() - started - flushedMs;
    console.info(`deactivation: flush ${flushedMs} ms, engine stop ${stoppedMs} ms`);

    expect(flushedMs + stoppedMs).toBeLessThan(DEACTIVATION_BUDGET_MS);
    expect(unsaved).toBe(false);
    expect(canvasState(root).equals(opened)).toBe(false);
    expect(alive(enginePid)).toBe(false);
    expect(reports).toEqual([]);
  });

  test('the last release of a session whose source turned refused says why it did not save, and closes it', async () => {
    const { root } = moduleDirectory();
    const saving = keeper();
    const { rootSessions } = realEngine({ observer: saving.attach });
    const hold = await rootSessions.acquire(root);
    const opened = canvasState(root);
    let frame = { unsaved: false, sourceRefused: false };
    hold.ports.source.subscribe(
      (next) => {
        frame = next;
      },
      () => {},
    );
    await hold.ports.editor.apply(EDIT);
    await until('the unsaved frame', () => frame.unsaved);
    writeFileSync(join(root, 'main.tf'), 'variable "name" {\n');
    await until('the refused source', () => frame.sourceRefused);

    await hold.release();
    const said = `was not saved (source_refused): [failed_precondition] the source tf is refused; fix it, then edit, save or generate again`;
    expect(saving.log).toEqual([`The canvas of ${root} ${said}`]);
    expect(saving.shown).toEqual([`The canvas of ${root} ${said}`]);
    expect(rootSessions.held()).toEqual([]);
    expect(canvasState(root).equals(opened)).toBe(true);
  });
});

describe('an engine the extension cannot work with', () => {
  // The real engine with its handshake's protocol line rewritten to name
  // `protocol`: an engine of another protocol, as the host sees one.
  function engineSpeaking(protocol: number): string {
    const directory = mkdtempSync(join(tmpdir(), 'lace-engine-'));
    afterTest(() => rmSync(directory, { recursive: true, force: true }));
    const wrapper = join(directory, 'lace');
    writeFileSync(
      wrapper,
      `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const engine = spawn(${JSON.stringify(BINARY)}, process.argv.slice(2), { stdio: ['inherit', 'pipe', 'inherit'] });
readline.createInterface({ input: engine.stdout }).on('line', (line) => {
  process.stdout.write(line.replace(/^LACE_ENGINE_PROTOCOL_VERSION=\\d+$/, 'LACE_ENGINE_PROTOCOL_VERSION=${protocol}') + '\\n');
});
engine.on('exit', (code) => process.exit(code ?? 1));
`,
    );
    chmodSync(wrapper, 0o755);
    return wrapper;
  }

  test('an engine below the protocol this extension speaks is reported as too old', async () => {
    const older = Number(ENGINE_PROTOCOL_VERSION) - 1;
    const { engine } = realEngine({ binaryPath: engineSpeaking(older) });
    const refused = await engine.caller().catch((error) => error);

    expect(refused).toBeInstanceOf(EngineStartError);
    expect(refused.message).toBe(
      `The Lace CLI at ${refused.binaryPath} is too old for this extension: it speaks engine protocol ${older} and this extension needs ${ENGINE_PROTOCOL_VERSION}. Update the Lace CLI, or point the setting lace.binaryPath at a newer one.`,
    );
    expect(engine.state()).toBe('error');
  });

  test('an engine above it is reported as newer than this extension', async () => {
    const newer = Number(ENGINE_PROTOCOL_VERSION) + 1;
    const { engine } = realEngine({ binaryPath: engineSpeaking(newer) });
    const refused = await engine.caller().catch((error) => error);

    expect(refused.message).toBe(
      `The Lace CLI at ${refused.binaryPath} is newer than this extension: it speaks engine protocol ${newer} and this extension speaks ${ENGINE_PROTOCOL_VERSION}. Update the Lace extension.`,
    );
  });
});
