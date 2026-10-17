// Fakes for the tools' tests: an authoring session over a small Bundle, the
// root sessions that hold it, and VS Code's cancellation of a tool call.
import {
  type Action,
  type ApplyResult,
  type CanvasSource,
  GENERATE_STAGES,
  type GenerateEvent,
  InputMode,
  parseBound,
  type SourcePort,
} from '@lace-cloud/canvas/engine';
import { Bundle } from '@lace-cloud/proto';
import { vi } from 'vitest';
import type * as vscode from 'vscode';
import { fakeCommands } from '../../engine/__tests__/fake-commands';
import type { RootHold, RootSession } from '../../engine/root-sessions';

// `module validate`'s report of a tree in Lace style, as the CLI prints one.
export const VALIDATED = {
  root: '<root>',
  treeHash: 'tree-1',
  verdict: 'already-lace-style',
  residuals: [],
  deviation: {
    notCompositional: false,
    clusters: [],
    residuals: [],
    hasManagedBackend: false,
    backendFindings: [],
    sharedLocalSource: false,
    sharedLocalFindings: [],
    uncomposable: false,
    uncomposableReason: '',
    registryVersionNotExact: [],
    childNotLaceForm: [],
  },
  terraform: { valid: true, diagnostics: [] },
  modules: [],
  exitClass: 'ok',
  diagnostics: [],
};

function input(name: string, sensitive = false) {
  return { name, type: 'string', required: false, description: '', sensitive };
}

// The canvas the tests work on:
//   net → vpc      output id
//   app → service  inputs name ("web"), subnet, token (sensitive); output url
//   db  → rds      input name; output endpoint
export function fixtureBundle(): Bundle {
  return Bundle.fromPartial({
    entry: 'root@v1',
    modules: {
      'root@v1': {
        id: 'root',
        version: 'v1',
        modules: [
          { id: 'net', module: 'vpc@v1' },
          { id: 'app', module: 'service@v1', inputs: { name: { lit: 'web' } } },
          { id: 'db', module: 'rds@v1' },
        ],
      },
      'vpc@v1': {
        id: 'vpc',
        version: 'v1',
        interface: { inputs: [], outputs: [{ name: 'id', type: 'string', description: '' }] },
      },
      'service@v1': {
        id: 'service',
        version: 'v1',
        interface: {
          inputs: [input('name'), input('subnet'), input('token', true)],
          outputs: [{ name: 'url', type: 'string', description: '' }],
        },
      },
      'rds@v1': {
        id: 'rds',
        version: 'v1',
        interface: {
          inputs: [input('name')],
          outputs: [{ name: 'endpoint', type: 'string', description: '' }],
        },
      },
    },
  });
}

function callOf(bundle: Bundle, scope: string, id: string) {
  const use = bundle.modules[scope]?.modules.find((each) => each.id === id);
  if (!use) throw new Error(`fake engine: no instance ${id} in ${scope}`);
  return use;
}

// One action applied to a copy of the Bundle, as the engine applies it.
function reduce(bundle: Bundle, action: Action): Bundle {
  const next = structuredClone(bundle);
  if (action.update_input) {
    const { scope, instance_id, input_name, mode, value } = action.update_input;
    const inputs = callOf(next, scope, instance_id).inputs;
    if (mode === InputMode.INPUT_MODE_LITERAL) inputs[input_name] = { lit: value };
    if (mode === InputMode.INPUT_MODE_EMPTY) delete inputs[input_name];
  }
  if (action.rename_instance) {
    const { scope, old_id, new_id } = action.rename_instance;
    callOf(next, scope, old_id).id = new_id;
  }
  if (action.delete_instance) {
    const { scope, instance_id } = action.delete_instance;
    const owner = next.modules[scope];
    owner.modules = owner.modules.filter((each) => each.id !== instance_id);
  }
  return next;
}

// A session of the fixture's canvas, whose commands run on `commands`. The
// editor's apply, save and generate resolve once their frame is delivered,
// as the engine mapping's do. A Generate holds the session's one Generate
// (`generating`, at the stage it reached) from its first frame to its
// last, reporting each stage, and writes `main.tf`, which it changed.
export function fakeSession(sessionId = 'session-1', commands = fakeCommands({}).port) {
  let state: CanvasSource = {
    bundle: fixtureBundle(),
    canUndo: false,
    canRedo: false,
    unsaved: false,
    ungenerated: false,
    conflict: null,
    sourceRefused: false,
    generating: false,
    diagnostics: [],
    treeHash: 'tree-0',
  };
  const listeners = new Set<(frame: CanvasSource) => void>();
  const publish = (next: CanvasSource): void => {
    state = next;
    for (const listener of [...listeners]) listener(state);
  };

  const source: SourcePort = {
    subscribe(on) {
      listeners.add(on);
      on(state);
      return () => {
        listeners.delete(on);
      };
    },
  };

  const editor = {
    apply: vi.fn(async (actions: readonly Action[]): Promise<ApplyResult> => {
      publish({
        ...state,
        bundle: actions.reduce(reduce, state.bundle),
        unsaved: true,
        canUndo: true,
      });
      return { success: true, errors: [], created: [], ties: [] };
    }),
    save: vi.fn(async () => {
      publish({ ...state, unsaved: false, ungenerated: true });
    }),
    generate: vi.fn(() =>
      (async function* (): AsyncGenerator<GenerateEvent> {
        for (const stage of GENERATE_STAGES) {
          publish({ ...state, generating: stage });
          yield { type: 'progress', stage };
        }
        publish({ ...state, generating: false, ungenerated: false });
        yield {
          type: 'success',
          written: ['main.tf'],
          changed: ['main.tf'],
          removed: [],
          validate: parseBound('module validate', VALIDATED),
        };
      })(),
    ),
    wiringCandidates: vi.fn(async () => []),
    resolveConflict: vi.fn(async () => {}),
  };

  const session: RootSession = {
    root: '/work/repo/infra/prod',
    sessionId,
    ports: { source, editor, commands, context: { sessionId } },
  };

  return { session, editor, listeners: () => listeners.size };
}

// Root sessions holding one root's fake session, with the root sessions'
// rule for holders: every hold is on the session the root is on now, the
// last release closes it, and a renewal moves the holders to the session the
// root is opened on again.
export function fakeRootSessions(first: RootSession) {
  const acquired: string[] = [];
  let session = first;
  let holders = 0;
  const rootSessions = {
    acquire: vi.fn(async (root: string): Promise<RootHold> => {
      acquired.push(root);
      holders += 1;
      let released = false;
      return {
        get root() {
          return session.root;
        },
        get sessionId() {
          return session.sessionId;
        },
        get ports() {
          return session.ports;
        },
        renewed: () => () => {},
        release: async () => {
          if (released) return;
          released = true;
          holders -= 1;
        },
      };
    }),
    held: () => (holders > 0 ? [{ ...session, holders }] : []),
  };
  return {
    rootSessions,
    acquired,
    holders: () => holders,
    // The root's session ended and the root was opened again on `next`.
    renew(next: RootSession): void {
      session = next;
    },
  };
}

// Lets every pending promise callback run.
export const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

// VS Code's cancellation of a tool call: a token that is cancelled once,
// telling each listener still listening.
export function fakeCancellation() {
  const listeners = new Set<(cancelled: undefined) => unknown>();
  let cancelled = false;
  const token: vscode.CancellationToken = {
    get isCancellationRequested() {
      return cancelled;
    },
    onCancellationRequested: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
  return {
    token,
    listening: () => listeners.size,
    cancel(): void {
      cancelled = true;
      for (const listener of [...listeners]) listener(undefined);
    },
  };
}
