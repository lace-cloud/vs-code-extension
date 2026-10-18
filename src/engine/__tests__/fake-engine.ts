// A fake engine at the bridge: it reads each request `bridgeCaller` posts as
// its method's proto-JSON and answers with proto-JSON, as `serveEngineBridge`
// would, so the code under test runs the real caller, the real mapping and
// the real codecs. It keeps what a real engine keeps — one session per
// directory, until some client closes it, and the revision of each session's
// latest frame, which an answer that moved the state names — and a test
// decides when a deferred answer is given and how a stream ends. A Generate
// reports each of its stages on the session's streams, then writes
// `main.tf`, which it changed and which is the whole render, and its
// validate finds the tree in Lace style. An Invoke says its command
// started, then that it exited 0, as the engine's protocol orders them.
import { type BridgeEngineCaller, bridgeCaller, GENERATE_STAGES } from '@lace-cloud/canvas/engine';
import {
  type BridgeRequest,
  type BridgeResponse,
  ENGINE_PROTOCOL_VERSION,
} from '@lace-cloud/proto';
import { VALIDATED } from '../../tools/__tests__/fake-session';

// A request as the bridge carried it: its proto-JSON, by JSON names.
export type Sent = { method: string; request: Record<string, unknown> };

type Session = {
  id: string;
  directory: string;
  streams: Set<string>;
  unsaved: boolean;
  sourceRefused: boolean;
  revision: number;
};

let engines = 0;

export function fakeEngine(options: { sameDirectory?: (path: string) => string } = {}) {
  const engine = ++engines;
  const directoryOf = options.sameDirectory ?? ((path: string) => path);
  const listeners = new Set<(m: unknown) => void>();
  const sessions = new Map<string, Session>();
  const sent: Sent[] = [];
  const deferred = new Map<string, (() => void)[]>();
  const refusals = new Map<
    string,
    { code: string; message: string; reason: string; apiCode?: string }
  >();
  let opened = 0;
  let dead = false;

  const post = (frame: BridgeResponse): void => {
    for (const listener of [...listeners]) listener(frame);
  };
  const stateOf = (session: Session) => ({
    unsaved: session.unsaved,
    source_refused: session.sourceRefused,
    tree_hash: 'tree',
    revision: session.revision,
  });
  const unavailable = (id: string): BridgeResponse => ({
    kind: 'error',
    id,
    code: 'unavailable',
    message: 'the engine is gone',
    reason: 'REASON_UNSPECIFIED',
  });

  // The engine's answer to one unary call, after what the call does.
  function answer(id: string, method: string, request: Record<string, unknown>): BridgeResponse {
    if (dead) return unavailable(id);
    const refusal = refusals.get(method);
    if (refusal) return { kind: 'error', id, ...refusal };
    if (method === 'Initialize') {
      return {
        kind: 'result',
        id,
        response: {
          server_version: 'fake',
          protocol_version: ENGINE_PROTOCOL_VERSION,
          command_paths: [],
        },
      };
    }
    if (method === 'SessionOpen') {
      const directory = directoryOf((request.root as { path: string }).path);
      let session = [...sessions.values()].find((s) => s.directory === directory);
      if (!session) {
        opened += 1;
        session = {
          id: `engine${engine}-session${opened}`,
          directory,
          streams: new Set(),
          unsaved: false,
          sourceRefused: false,
          revision: 0,
        };
        sessions.set(session.id, session);
      }
      return { kind: 'result', id, response: { session_id: session.id, state: stateOf(session) } };
    }
    if (method === 'SessionClose') {
      const session = sessions.get(request.sessionId as string);
      sessions.delete(request.sessionId as string);
      for (const stream of session?.streams ?? []) post({ kind: 'end', id: stream });
      return { kind: 'result', id, response: { status: 'ok' } };
    }
    if (method === 'ApplyAction') {
      const revision = sessions.get(request.sessionId as string)?.revision ?? 0;
      return {
        kind: 'result',
        id,
        response: { success: true, errors: [], created: [], ties: [], revision },
      };
    }
    if (method === 'SessionGenerate') {
      const session = sessions.get(request.sessionId as string);
      for (const stage of GENERATE_STAGES) {
        for (const stream of session?.streams ?? []) {
          post({
            kind: 'event',
            id: stream,
            event: { generate_progress: { stage, message: '', generate_id: request.generateId } },
          });
        }
      }
      if (session) moved(session.id, {});
      return {
        kind: 'result',
        id,
        response: {
          files_written: ['main.tf'],
          files_changed: ['main.tf'],
          files_removed: [],
          validate_json: JSON.stringify(VALIDATED),
          revision: session?.revision ?? 0,
        },
      };
    }
    if (method === 'SessionSave') {
      const session = sessions.get(request.sessionId as string);
      if (session?.sourceRefused) {
        return {
          kind: 'error',
          id,
          code: 'failed_precondition',
          message: 'the source tf is refused; fix it, then edit, save or generate again',
          reason: 'REASON_SOURCE_REFUSED',
        };
      }
      if (session) moved(session.id, { unsaved: false });
      return { kind: 'result', id, response: { revision: session?.revision ?? 0 } };
    }
    return { kind: 'result', id, response: {} };
  }

  // The session's state moves: a new frame, at the next revision.
  function moved(sessionId: string, change: Partial<Pick<Session, 'unsaved' | 'sourceRefused'>>) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`no session ${sessionId}`);
    Object.assign(session, change);
    session.revision += 1;
    for (const stream of session.streams) {
      post({ kind: 'event', id: stream, event: { state: stateOf(session) } });
    }
  }

  function receive(frame: BridgeRequest): void {
    if (frame.kind === 'abort') {
      for (const session of sessions.values()) session.streams.delete(frame.id);
      return;
    }
    const request = frame.request as Record<string, unknown>;
    sent.push({ method: frame.method, request });
    if (frame.kind === 'unary') {
      const give = () => post(answer(frame.id, frame.method, request));
      const waiting = deferred.get(frame.method);
      if (waiting) waiting.push(give);
      else give();
    } else if (dead) {
      post(unavailable(frame.id));
    } else if (frame.method === 'Subscribe') {
      sessions.get(request.sessionId as string)?.streams.add(frame.id);
    } else {
      post({ kind: 'event', id: frame.id, event: { started: {} } });
      post({ kind: 'event', id: frame.id, event: { exit: { code: 0, stderr_tail: '' } } });
      post({ kind: 'end', id: frame.id });
    }
  }

  const caller: BridgeEngineCaller = bridgeCaller({
    post: (frame) => receive(frame as BridgeRequest),
    onMessage: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  return {
    caller,
    sent,
    count: (method: string) => sent.filter((s) => s.method === method).length,
    // The ids of the sessions the engine holds open.
    open: () => [...sessions.keys()],
    // Calls of `method` wait until the returned function is called.
    defer(method: string): () => void {
      deferred.set(method, []);
      return () => {
        const waiting = deferred.get(method) ?? [];
        deferred.delete(method);
        for (const give of waiting) give();
      };
    },
    // Calls of `method` are refused with `reason`, and `apiCode` when the
    // API decided the refusal.
    refuse(method: string, reason: string, message = 'refused', apiCode?: string): void {
      refusals.set(method, { code: 'failed_precondition', message, reason, apiCode });
    },
    edit: (sessionId: string) => moved(sessionId, { unsaved: true }),
    // The session's tf turns refused: a frame says so, and a save is refused
    // with REASON_SOURCE_REFUSED, as the engine refuses every save under it.
    refuseSource: (sessionId: string) => moved(sessionId, { sourceRefused: true }),
    // The session's streams fail and the session stays open: what a
    // subscriber that fell behind sees.
    failStreams(sessionId: string): void {
      const session = sessions.get(sessionId);
      for (const stream of session?.streams ?? []) {
        post({
          kind: 'error',
          id: stream,
          code: 'resource_exhausted',
          message: 'subscriber_overflow',
          reason: 'REASON_UNSPECIFIED',
        });
      }
      session?.streams.clear();
    },
    // Another client closes the session.
    closeFromElsewhere(sessionId: string): void {
      const session = sessions.get(sessionId);
      sessions.delete(sessionId);
      for (const stream of session?.streams ?? []) post({ kind: 'end', id: stream });
    },
    // The process exits: every stream fails and every later call does.
    crash(): void {
      dead = true;
      for (const session of sessions.values()) {
        for (const stream of session.streams) post(unavailable(stream));
      }
      sessions.clear();
    },
  };
}

export type FakeEngine = ReturnType<typeof fakeEngine>;

// Lets every promise chain that is ready run.
export const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
