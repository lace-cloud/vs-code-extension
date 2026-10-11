// Fakes for the tools' tests: an authoring session over a small Bundle, the
// root sessions that hold it and keep what is attached to it, and Lace's API
// as chat-core's transport reaches it.
import {
  type Action,
  type ApplyResult,
  type CanvasSource,
  type GenerateEvent,
  InputMode,
  parseBound,
  type SourcePort,
} from '@lace-cloud/canvas/engine';
import type { Candidate, Ranked, Transport } from '@lace-cloud/chat-core';
import { Bundle } from '@lace-cloud/proto';
import { vi } from 'vitest';
import type * as vscode from 'vscode';
import { fakeCommands } from '../../engine/__tests__/fake-commands';
import {
  NotObservedError,
  type Observation,
  type RootHold,
  type RootSession,
  type SessionAttachment,
  type SessionObserver,
} from '../../engine/root-sessions';

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

// A session of the fixture's canvas, whose commands run on `commands`.
// Every frame it publishes is at the next revision, and the editor's apply,
// save and generate resolve once their frame is delivered, the apply naming
// the revision it produced, as the engine mapping's do.
export function fakeSession(sessionId = 'session-1', commands = fakeCommands({}).port) {
  let state: CanvasSource = {
    bundle: fixtureBundle(),
    canUndo: false,
    canRedo: false,
    unsaved: false,
    ungenerated: false,
    conflict: null,
    sourceRefused: false,
    diagnostics: [],
    treeHash: 'tree-0',
    revision: 1,
  };
  const history: CanvasSource[] = [];
  const listeners = new Set<(frame: CanvasSource) => void>();
  const publish = (next: Omit<CanvasSource, 'revision'>): number => {
    state = { ...next, revision: state.revision + 1 };
    for (const listener of [...listeners]) listener(state);
    return state.revision;
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
      history.push(state);
      const revision = publish({
        ...state,
        bundle: actions.reduce(reduce, state.bundle),
        unsaved: true,
        canUndo: true,
      });
      return { success: true, errors: [], created: [], ties: [], revision };
    }),
    save: vi.fn(async () => {
      publish({ ...state, unsaved: false, ungenerated: true });
    }),
    generate: vi.fn(() =>
      (async function* (): AsyncGenerator<GenerateEvent> {
        publish({ ...state, ungenerated: false });
        yield {
          type: 'success',
          written: ['main.tf'],
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

  return {
    session,
    editor,
    publish,
    state: () => state,
    listeners: () => listeners.size,
    // The canvas undoes the last apply.
    undo: () => publish({ ...(history.pop() ?? state), unsaved: true }),
  };
}

// Root sessions holding one root's fake session, with the root sessions'
// rule for holders and observers: the first holder opens the session and
// attaches every observer to it, the last release closes it and disposes
// each attachment, and a renewal moves the holders and the observers to the
// session the root is opened on again. An attachment runs use is disposed
// when the last of them settles.
export function fakeRootSessions(first: RootSession) {
  const acquired: string[] = [];
  let session = first;
  let holders = 0;
  const watchers = new Set<{ attach: () => void; detach: () => void }>();
  const attachAll = () => {
    for (const watcher of watchers) watcher.attach();
  };
  const detachAll = () => {
    for (const watcher of watchers) watcher.detach();
  };
  const rootSessions = {
    acquire: vi.fn(async (root: string): Promise<RootHold> => {
      acquired.push(root);
      holders += 1;
      if (holders === 1) attachAll();
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
          if (holders === 0) detachAll();
        },
      };
    }),
    observe<A extends SessionAttachment>(observer: SessionObserver<A>): Observation<A> {
      let attached: A | undefined;
      const using = new Map<A, number>();
      const retired = new Set<A>();
      const watcher = {
        attach: () => {
          attached = observer(session);
        },
        detach: () => {
          if (attached !== undefined && using.has(attached)) retired.add(attached);
          else attached?.dispose();
          attached = undefined;
        },
      };
      watchers.add(watcher);
      if (holders > 0) watcher.attach();
      return {
        async use(hold, run) {
          const on = attached;
          if (on === undefined) throw new NotObservedError(hold.root);
          using.set(on, (using.get(on) ?? 0) + 1);
          try {
            return await run(on);
          } finally {
            const left = (using.get(on) ?? 1) - 1;
            if (left > 0) using.set(on, left);
            else {
              using.delete(on);
              if (retired.delete(on)) on.dispose();
            }
          }
        },
        dispose: () => {
          watchers.delete(watcher);
          watcher.detach();
        },
      };
    },
    held: () => (holders > 0 ? [{ ...session, holders }] : []),
  };
  return {
    rootSessions,
    acquired,
    holders: () => holders,
    // The root's session ended and the root was opened again on `next`.
    renew(next: RootSession): void {
      if (holders > 0) detachAll();
      session = next;
      if (holders > 0) attachAll();
    },
  };
}

// The candidates of a rank call's body.
function candidatesOf(body: unknown): readonly Candidate[] {
  return typeof body === 'object' && body !== null && 'candidates' in body
    ? Array.isArray(body.candidates)
      ? body.candidates
      : []
    : [];
}

// A request chat-core's transport made of Lace's API.
export type ApiRequest = { path: string; body: unknown };

// Lace's API as chat-core reaches it: the ranking puts the first candidate
// of each question whose id is in `prefer` on top, sure of it, and every
// report is accepted. Each request is recorded.
export function fakeLaceApi(prefer: readonly string[]) {
  const requests: ApiRequest[] = [];
  let captures = 0;
  const ranked = (candidates: readonly Candidate[]): Ranked => {
    const first = candidates.filter((candidate) => prefer.includes(candidate.id)).slice(0, 1);
    const others = candidates.filter((candidate) => !first.includes(candidate));
    captures += 1;
    return {
      capture_id: `capture-${captures}`,
      head: 'head-1',
      scores: [
        ...first.map((candidate) => ({ id: candidate.id, score: 9, rightness: 0.95 })),
        ...others.map((candidate) => ({ id: candidate.id, score: 1, rightness: 0.01 })),
      ],
      thresholds: {
        operation: { from: 0.9 },
        instance: { from: 0.9 },
        input: { from: 0.9 },
        module: { from: 0.9 },
        connection: { from: 0.9 },
        steps: { from: 0.9 },
      },
    };
  };
  const transport: Transport = async (path, { body }) => {
    requests.push({ path, body });
    if (path === '/api/v1/candidates/rank')
      return { status: 200, body: ranked(candidatesOf(body)) };
    return { status: 201, body: {} };
  };
  return { transport, requests };
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

// Lace's API that answers no rank: each rank request waits until the signal
// chat-core gives it aborts, then rejects as an aborted fetch rejects.
export function silentLaceApi() {
  const requests: ApiRequest[] = [];
  const transport: Transport = (path, { body, signal }) => {
    requests.push({ path, body });
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () =>
        reject(new DOMException('This operation was aborted', 'AbortError')),
      );
    });
  };
  return { transport, requests };
}
