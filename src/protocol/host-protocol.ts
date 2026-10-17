// The two protocols one webview and its panel share over one postMessage
// pair, and the envelope that keeps them apart: the engine bridge, whose
// frames `@lace-cloud/proto` owns, and the host protocol, for what lives in
// the webview and needs VS Code. Both bundles import this file, so the wire
// shape cannot drift between them. Nothing here reads VS Code or the DOM.
//
// Every message on the wire is `{ch: 'engine', frame}` or `{ch: 'host',
// frame}`. A frame from the webview is untrusted input: each one is parsed
// out of `unknown` before any field on it is read; a frame from the host is
// parsed the same way, so each side reads only the shapes named here.
import {
  type CommandFailure,
  type ConfirmSpec,
  type GenerateEvent,
  parseCommandFailure,
  type StackRef,
} from '@lace-cloud/canvas/engine';
import type { CanvasArrangement, MessageBridge } from '@lace-cloud/proto';

// One end of a postMessage pair, as both VS Code sides present it.
export type RawPort = {
  post: (message: unknown) => void;
  onMessage: (listener: (message: unknown) => void) => () => void;
};

type Channel = 'engine' | 'host';

function envelopeOf(message: unknown): { ch: Channel; frame: unknown } | null {
  if (typeof message !== 'object' || message === null) return null;
  if (!('ch' in message) || !('frame' in message)) return null;
  const { ch, frame } = message;
  if (ch !== 'engine' && ch !== 'host') return null;
  return { ch, frame };
}

function channel(raw: RawPort, ch: Channel): RawPort {
  return {
    post: (frame) => raw.post({ ch, frame }),
    onMessage: (listener) =>
      raw.onMessage((message) => {
        const envelope = envelopeOf(message);
        if (envelope?.ch === ch) listener(envelope.frame);
      }),
  };
}

// The engine bridge and the host protocol as two ports over one pair: each
// receives exactly the frames it would on a pair of its own.
export function splitChannel(raw: RawPort): { engine: MessageBridge; host: RawPort } {
  return { engine: channel(raw, 'engine') as MessageBridge, host: channel(raw, 'host') };
}

// ── The host protocol ──

// What the page learns when it boots: the root its session is on, the
// arrangement the host kept for it, and the stack picked for it, which the
// canvas reads as `context.stack`.
export type Boot = { root: string; arrangement: CanvasArrangement; stack?: StackRef };

// A place in the root's Terraform: a file relative to the root, and the
// line and column a diagnostic names, counted from 1.
export type SourceLocation = { file: string; line?: number; column?: number };

// Webview → host, answered. `openSource` opens the file at its line and
// column in the editor beside the canvas; it answers `null` once the
// editor shows it, and fails with what stopped it. `importResources` runs
// Import Existing Resources on the panel's root and answers `null` once it
// has ended.
export type HostCalls = {
  boot: { request: Record<string, never>; response: Boot };
  confirm: { request: ConfirmSpec; response: boolean };
  openSource: { request: SourceLocation; response: null };
  importResources: { request: Record<string, never>; response: null };
};

// What a Generate that succeeded reports of the tree it wrote, as the
// engine reports it: every file it wrote (the whole render), the ones whose
// bytes it changed, and the source tf it removed.
export type Generated = Pick<
  Extract<GenerateEvent, { type: 'success' }>,
  'written' | 'changed' | 'removed'
>;

// Webview → host, one way. `focus` is the page's own window gaining or
// losing focus, which fires wherever focus goes next. `notify` carries the
// failure document of the command it is about, when that command wrote
// one, so the host offers the ways out its reason names. `generated` is
// what the canvas's own Generate that succeeded reports of the tree it
// wrote.
export type HostNotice =
  | { op: 'arrangement'; value: CanvasArrangement }
  | { op: 'notify'; level: 'info' | 'warn' | 'error'; text: string; failure?: CommandFailure }
  | { op: 'unsaved'; value: boolean }
  | { op: 'focus'; value: boolean }
  | { op: 'generated'; files: Generated };

// Host → webview, one way: the root's picked stack changed, or a run the
// host started settled and the canvas's reads are stale.
export type PageEvent = { op: 'stack'; value?: StackRef } | { op: 'tick' };

export type HostHandlers = {
  [K in keyof HostCalls]: (request: HostCalls[K]['request']) => Promise<HostCalls[K]['response']>;
} & { notice: (notice: HostNotice) => void };

type CallFrame = { kind: 'call'; id: string; name: string; request: unknown };
type NoticeFrame = { kind: 'notice'; notice: unknown };
type ReplyFrame = { kind: 'reply'; id: string; response: unknown };
type FailFrame = { kind: 'fail'; id: string; message: string };
type EventFrame = { kind: 'event'; event: PageEvent };

const CALLS: readonly (keyof HostCalls)[] = ['boot', 'confirm', 'openSource', 'importResources'];
const NOTICES: readonly HostNotice['op'][] = [
  'arrangement',
  'notify',
  'unsaved',
  'focus',
  'generated',
];
const LEVELS = ['info', 'warn', 'error'];

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((each) => typeof each === 'string');

function generatedOf(value: unknown): Generated | null {
  if (!record(value)) return null;
  const { written, changed, removed } = value;
  return strings(written) && strings(changed) && strings(removed)
    ? { written, changed, removed }
    : null;
}

function inbound(frame: unknown): CallFrame | NoticeFrame | null {
  if (!record(frame)) return null;
  if (frame.kind === 'notice' && 'notice' in frame) return { kind: 'notice', notice: frame.notice };
  if (frame.kind !== 'call') return null;
  const { id, name, request } = frame;
  if (typeof id !== 'string' || typeof name !== 'string') return null;
  return { kind: 'call', id, name, request };
}

function outbound(frame: unknown): ReplyFrame | FailFrame | EventFrame | null {
  if (!record(frame)) return null;
  if (frame.kind === 'event') {
    const event = pageEventOf(frame.event);
    return event ? { kind: 'event', event } : null;
  }
  if (typeof frame.id !== 'string') return null;
  if (frame.kind === 'reply' && 'response' in frame) {
    return { kind: 'reply', id: frame.id, response: frame.response };
  }
  if (frame.kind === 'fail' && typeof frame.message === 'string') {
    return { kind: 'fail', id: frame.id, message: frame.message };
  }
  return null;
}

const isCall = (name: string): name is keyof HostCalls => (CALLS as string[]).includes(name);

export function noticeOf(value: unknown): HostNotice | null {
  if (!record(value) || typeof value.op !== 'string' || !(NOTICES as string[]).includes(value.op)) {
    return null;
  }
  if (value.op === 'unsaved' || value.op === 'focus') {
    return typeof value.value === 'boolean' ? { op: value.op, value: value.value } : null;
  }
  if (value.op === 'generated') {
    const files = generatedOf(value.files);
    return files ? { op: 'generated', files } : null;
  }
  if (value.op === 'notify') {
    const { level, text } = value;
    if (typeof level !== 'string' || !LEVELS.includes(level) || typeof text !== 'string')
      return null;
    const notice = {
      op: 'notify' as const,
      level: level as HostNotice & { op: 'notify' } extends { level: infer L } ? L : never,
      text,
    };
    if (value.failure === undefined) return notice;
    const failure = failureOf(value.failure);
    return failure ? { ...notice, failure } : null;
  }
  return record(value.value)
    ? { op: 'arrangement', value: value.value as CanvasArrangement }
    : null;
}

function failureOf(value: unknown): CommandFailure | null {
  try {
    return parseCommandFailure(value);
  } catch {
    return null;
  }
}

function stackRefOf(value: unknown): StackRef | null {
  if (!record(value) || typeof value.id !== 'string' || typeof value.slug !== 'string') return null;
  return { id: value.id, slug: value.slug };
}

export function pageEventOf(value: unknown): PageEvent | null {
  if (!record(value)) return null;
  if (value.op === 'tick') return { op: 'tick' };
  if (value.op !== 'stack') return null;
  if (value.value === undefined) return { op: 'stack' };
  const stack = stackRefOf(value.value);
  return stack ? { op: 'stack', value: stack } : null;
}

const optionalNumber = (value: unknown): value is number | undefined =>
  value === undefined || typeof value === 'number';

function sourceLocationOf(value: unknown): SourceLocation | null {
  if (!record(value) || typeof value.file !== 'string') return null;
  const { file, line, column } = value;
  if (!optionalNumber(line) || !optionalNumber(column)) return null;
  return {
    file,
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  };
}

function confirmSpecOf(value: unknown): ConfirmSpec | null {
  if (!record(value) || typeof value.text !== 'string') return null;
  if ('typed' in value && value.typed !== undefined && typeof value.typed !== 'string') return null;
  return { text: value.text, typed: value.typed as string | undefined };
}

// Serves the host protocol over `port` until the returned function is
// called: each call is answered by its handler, a handler that throws
// answers with its message, and each well-formed notice reaches `notice`.
export function serveHost(port: RawPort, handlers: HostHandlers): () => void {
  return port.onMessage((raw) => {
    const frame = inbound(raw);
    if (!frame) return;
    if (frame.kind === 'notice') {
      const notice = noticeOf(frame.notice);
      if (notice) handlers.notice(notice);
      return;
    }
    const { id, name, request } = frame;
    const fail = (message: string) => port.post({ kind: 'fail', id, message } satisfies FailFrame);
    if (!isCall(name)) return fail(`unknown call: ${name}`);
    const answer = (): Promise<unknown> => {
      if (name === 'boot') return handlers.boot({});
      if (name === 'importResources') return handlers.importResources({});
      if (name === 'openSource') {
        const location = sourceLocationOf(request);
        return location
          ? handlers.openSource(location)
          : Promise.reject(new Error('openSource: no file'));
      }
      const spec = confirmSpecOf(request);
      return spec ? handlers.confirm(spec) : Promise.reject(new Error('confirm: no text'));
    };
    answer().then(
      (response) => port.post({ kind: 'reply', id, response } satisfies ReplyFrame),
      (error) => fail(error instanceof Error ? error.message : String(error)),
    );
  });
}

// Sends the page an event.
export function postEvent(port: RawPort, event: PageEvent): void {
  port.post({ kind: 'event', event } satisfies EventFrame);
}

export type HostCaller = {
  call: <K extends keyof HostCalls>(
    name: K,
    request: HostCalls[K]['request'],
  ) => Promise<HostCalls[K]['response']>;
  notify: (notice: HostNotice) => void;
  // `listener` receives every well-formed event the host sends.
  onEvent: (listener: (event: PageEvent) => void) => () => void;
};

// The webview's end: `call` resolves with the host's reply to that call.
export function hostCaller(port: RawPort): HostCaller {
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const events = new Set<(event: PageEvent) => void>();
  let next = 0;
  port.onMessage((raw) => {
    const frame = outbound(raw);
    if (!frame) return;
    if (frame.kind === 'event') {
      for (const listener of [...events]) listener(frame.event);
      return;
    }
    const waiting = pending.get(frame.id);
    if (!waiting) return;
    pending.delete(frame.id);
    if (frame.kind === 'reply') waiting.resolve(frame.response);
    else waiting.reject(new Error(frame.message));
  });
  return {
    call: (name, request) =>
      new Promise((resolve, reject) => {
        const id = String(++next);
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        port.post({ kind: 'call', id, name, request } satisfies CallFrame);
      }),
    notify: (notice) => port.post({ kind: 'notice', notice } satisfies NoticeFrame),
    onEvent: (listener) => {
      events.add(listener);
      return () => events.delete(listener);
    },
  };
}
