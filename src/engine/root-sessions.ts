// Root sessions: the one owner of each authoring root's session in this
// window. The engine keeps a root's session, its unsaved edits and its lock
// until some client sends `SessionClose`, and counts nothing; this module
// counts the holders and is the only code that sends `SessionClose`.
//
// The engine names the session. `acquire(root)` sends the root as it was
// given and reads the id the engine answers with: two spellings of one
// directory come back as one id, and the holder map is keyed on it.
//
// A hold is on the root and follows its session. When a session's stream
// ends, its holders are still holders: the root is opened again for them. A
// `failed` end says only that the stream is gone — `SessionOpen` joins the
// session when it is still alive — and a `closed` end says the session is
// gone, so the engine names a new one. `SessionClose` is sent for the id the
// holders are on when the last one releases, and never for a session whose
// stream ended `closed`.
//
// An observer (the Problems panel, the autosave keeper, the chat's canvas
// tool sets) attaches to every session that has a holder, and again to the
// session a renewal puts the root on; it never holds one. What it returns is
// disposed when the root leaves that session: at the close the last release
// sends, at a renewal, at dispose, or when the observation ends. A holder
// runs on what an observer attached to the session it is on now through the
// observation (`use`), so what lives as long as a session is kept here, with
// the session; an attachment the root leaves while runs use it is disposed
// when the last of them settles. An attachment that keeps unsaved work
// carries a `flush`, and the session is closed or forgotten only once every
// flush has settled.
//
// `SessionOpen` and `SessionClose` are sent one at a time. An open that
// overtook a close on its way would be answered with the session the close
// then ends, and a close decided while an open is on its way would end the
// session that open is about to join.
import {
  type BridgeEngineCaller,
  type EngineSession,
  openEngineSession,
  type SourceEnd,
} from '@lace-cloud/canvas/engine';

export type SessionPorts = EngineSession['ports'];

export type RootSession = {
  // The root as the first holder spelled it.
  readonly root: string;
  readonly sessionId: string;
  readonly ports: SessionPorts;
};

// A hold names the session it is on now: `sessionId` and `ports` change when
// that session ends and the root is opened again.
export type RootHold = RootSession & {
  // `listener` is called each time the hold's session ended and an attempt
  // to open the root again settled. The hold is then on the session the
  // engine named, or still on the ended one when the engine refused.
  renewed: (listener: () => void) => () => void;
  // The last release closes the session; releasing twice is releasing once.
  release: () => Promise<void>;
};

// What an observer attached to one session returns. `flush` settles what
// the observer keeps for the session before it is closed or forgotten; a
// rejection is reported and the close goes on.
export type SessionAttachment = {
  dispose: () => void;
  flush?: () => Promise<void>;
};

// Called with a session when it is attached.
export type SessionObserver<A extends SessionAttachment = SessionAttachment> = (
  session: RootSession,
) => A;

// An observer attached to the held sessions.
export type Observation<A extends SessionAttachment> = {
  // Runs `run` on what the observer attached to the session `hold` is on
  // now. The attachment is not disposed while `run` is under way, though the
  // root leave that session meanwhile: it is disposed once the last run on
  // it settles. Rejects with `NotObservedError` when nothing is attached to
  // that session: the root left it, or the observer threw for it.
  use: <T>(hold: RootHold, run: (attachment: A) => Promise<T>) => Promise<T>;
  // Detaches the observer from every session, disposing each attachment no
  // run uses, and each other when its last run settles.
  dispose: () => void;
};

// A hold's session has nothing attached by an observation.
export class NotObservedError extends Error {
  constructor(readonly root: string) {
    super(`The session of ${root} is not observed.`);
  }
}

export type RootSessions = {
  acquire: (root: string) => Promise<RootHold>;
  // Attaches `observer` to every held session, now and as each is attached,
  // until the observation is disposed.
  observe: <A extends SessionAttachment>(observer: SessionObserver<A>) => Observation<A>;
  // The sessions that have a holder.
  held: () => readonly (RootSession & { holders: number })[];
  // Flushes every attachment of every held session, then forgets them all
  // without closing any: the engine's own shutdown closes its sessions.
  dispose: () => Promise<void>;
};

export type RootSessionsOptions = {
  engine: {
    caller: () => Promise<BridgeEngineCaller>;
    whenRunning: (other?: BridgeEngineCaller) => Promise<BridgeEngineCaller>;
  };
  report: (what: string, error: unknown) => void;
};

type Hold = { entry: Entry; listeners: Set<() => void> };

type Entry = {
  root: string;
  caller: BridgeEngineCaller;
  mapping: EngineSession;
  sessionId: string;
  // How the mapping's stream ended; null while it is live.
  ended: SourceEnd['kind'] | null;
  state: 'open' | 'closing' | 'closed';
  // The flushes under way while the entry is closing.
  saving: Promise<void> | null;
  holds: Set<Hold>;
  detach: () => void;
};

// One observer's attachments, one for each entry, to the session it is on.
type Watcher = {
  watch: (entry: Entry) => void;
  unwatch: (entry: Entry) => void;
  flush: (entry: Entry) => Promise<void> | undefined;
};

export class RootSessionsDisposedError extends Error {
  constructor() {
    super('The Lace extension is shutting down.');
  }
}

export function createRootSessions(options: RootSessionsOptions): RootSessions {
  const { engine, report } = options;
  const entries = new Map<string, Entry>();
  const watchers = new Set<Watcher>();
  // The internal hold behind each hold a caller has. Its entry is the one
  // the hold is on now: it moves when the holders join another entry.
  const internalHold = new WeakMap<RootHold, Hold>();
  let disposed = false;

  // One `SessionOpen` or `SessionClose` at a time, in the order asked.
  let turn: Promise<unknown> = Promise.resolve();
  function inTurn<T>(send: () => Promise<T>): Promise<T> {
    const sent = turn.then(send);
    turn = sent.catch(() => {});
    return sent;
  }

  async function open(caller: BridgeEngineCaller, root: string): Promise<EngineSession> {
    const mapping = await openEngineSession(caller, { root });
    if (mapping.ports.context.sessionId === undefined) {
      mapping.close();
      throw new Error(`the engine named no session for ${root}`);
    }
    return mapping;
  }

  const sessionOf = (entry: Entry): RootSession => ({
    root: entry.root,
    sessionId: entry.sessionId,
    ports: entry.mapping.ports,
  });

  // Attaches `observer` to every held session, keeping what it returned for
  // each entry, for the session the entry is on, until the observation is
  // disposed.
  function observe<A extends SessionAttachment>(observer: SessionObserver<A>): Observation<A> {
    const attached = new Map<Entry, A>();
    // How many runs use each attachment, and the attachments whose session
    // the root left while runs used them.
    const using = new Map<A, number>();
    const retired = new Set<A>();
    const disposeOf = (root: string, attachment: A): void => {
      try {
        attachment.dispose();
      } catch (error) {
        report(`detaching from the session of ${root}`, error);
      }
    };
    const watcher: Watcher = {
      watch(entry) {
        try {
          attached.set(entry, observer(sessionOf(entry)));
        } catch (error) {
          report(`observing the session of ${entry.root}`, error);
        }
      },
      unwatch(entry) {
        const attachment = attached.get(entry);
        attached.delete(entry);
        if (attachment === undefined) return;
        if (using.has(attachment)) retired.add(attachment);
        else disposeOf(entry.root, attachment);
      },
      flush: (entry) => attached.get(entry)?.flush?.(),
    };
    watchers.add(watcher);
    for (const entry of entries.values()) {
      if (entry.holds.size > 0) watcher.watch(entry);
    }
    return {
      async use(hold, run) {
        const entry = internalHold.get(hold)?.entry;
        const attachment = entry && attached.get(entry);
        if (entry === undefined || attachment === undefined) throw new NotObservedError(hold.root);
        using.set(attachment, (using.get(attachment) ?? 0) + 1);
        try {
          return await run(attachment);
        } finally {
          const left = (using.get(attachment) ?? 1) - 1;
          if (left > 0) using.set(attachment, left);
          else {
            using.delete(attachment);
            if (retired.delete(attachment)) disposeOf(entry.root, attachment);
          }
        }
      },
      dispose() {
        watchers.delete(watcher);
        for (const entry of [...attached.keys()]) watcher.unwatch(entry);
      },
    };
  }

  // Puts `entry` on `mapping`: the holder map names it by the mapping's
  // session id, the mapping's end is this entry's, and every observer is
  // attached to it.
  function attach(entry: Entry, caller: BridgeEngineCaller, mapping: EngineSession): void {
    entry.detach();
    if (entries.get(entry.sessionId) === entry) entries.delete(entry.sessionId);
    entry.caller = caller;
    entry.mapping = mapping;
    entry.sessionId = mapping.ports.context.sessionId ?? '';
    entry.ended = null;
    entries.set(entry.sessionId, entry);
    // `subscribe` replays an end that already happened, before it returns.
    let detached = false;
    const unsubscribe = mapping.ports.source.subscribe(
      () => {},
      (end) => {
        if (!detached) ended(entry, mapping, end);
      },
    );
    entry.detach = () => {
      detached = true;
      unsubscribe();
      for (const watcher of [...watchers]) watcher.unwatch(entry);
    };
    for (const watcher of watchers) watcher.watch(entry);
  }

  function ended(entry: Entry, mapping: EngineSession, end: SourceEnd): void {
    if (entry.mapping !== mapping) return;
    entry.ended = end.kind;
    if (end.kind === 'closed' && entries.get(entry.sessionId) === entry) {
      entries.delete(entry.sessionId);
    }
    // A closing entry has no holder to open for; its release decides.
    if (entry.state === 'open') void renew(entry);
  }

  // Opens the root again for the holders of an ended session, over the
  // engine that runs, and tells them each time that settled. An attempt the
  // engine refused is reported; the next is over the next engine to run,
  // since a stream that failed because the engine died ends before its
  // manager has seen the exit.
  async function renew(entry: Entry): Promise<void> {
    const holds = [...entry.holds];
    let refused: BridgeEngineCaller | undefined;
    while (!disposed && entry.holds.size > 0 && entry.ended !== null) {
      const caller = await engine.whenRunning(refused);
      try {
        await inTurn(() => reopen(entry, caller));
      } catch (error) {
        report(`opening ${entry.root} again after its session ended`, error);
        refused = caller;
      }
      for (const hold of holds) {
        for (const listener of [...hold.listeners]) {
          try {
            listener();
          } catch (error) {
            report(`a holder of ${entry.root} after its session was opened again`, error);
          }
        }
      }
    }
  }

  async function reopen(entry: Entry, caller: BridgeEngineCaller): Promise<void> {
    // Released, or already on a live session through a later acquire.
    if (disposed || entry.holds.size === 0 || entry.ended === null) return;
    const mapping = await open(caller, entry.root);
    const named = entries.get(mapping.ports.context.sessionId ?? '');
    if (named === undefined || named === entry) {
      attach(entry, caller, mapping);
      return;
    }
    // The engine named a session another entry is already on: this entry's
    // holders join it.
    mapping.close();
    entry.detach();
    for (const hold of entry.holds) {
      hold.entry = named;
      named.holds.add(hold);
    }
    entry.holds.clear();
    entry.state = 'closed';
  }

  // The flushes of a live session's attachments. It never rejects: a flush
  // that failed is reported, and what waited on it goes on.
  async function save(entry: Entry): Promise<void> {
    await Promise.all(
      [...watchers].map(async (watcher) => {
        try {
          await watcher.flush(entry);
        } catch (error) {
          report(`saving ${entry.root} before its session closes`, error);
        }
      }),
    );
  }

  // The last release: `open → closing → closed`. `closing` awaits every
  // attachment's flush, then takes its turn and looks at the holders again: an
  // acquire that arrived meanwhile joined this same session, and the close is
  // not sent.
  async function close(entry: Entry): Promise<void> {
    entry.state = 'closing';
    if (entry.ended === null) {
      entry.saving = save(entry);
      await entry.saving;
      entry.saving = null;
    }
    try {
      await inTurn(async () => {
        if (disposed) return;
        if (entry.holds.size > 0) {
          entry.state = 'open';
          if (entry.ended !== null) void renew(entry);
          return;
        }
        entry.state = 'closed';
        entry.detach();
        entry.mapping.close();
        if (entries.get(entry.sessionId) === entry) entries.delete(entry.sessionId);
        if (entry.ended === 'closed') return;
        await entry.caller.unary('SessionClose', { session_id: entry.sessionId });
      });
    } catch (error) {
      report(`closing the session of ${entry.root}`, error);
    }
  }

  function holdOn(entry: Entry): RootHold {
    const hold: Hold = { entry, listeners: new Set() };
    entry.holds.add(hold);
    let released = false;
    const rootHold: RootHold = {
      get root() {
        return hold.entry.root;
      },
      get sessionId() {
        return hold.entry.sessionId;
      },
      get ports() {
        return hold.entry.mapping.ports;
      },
      renewed(listener) {
        hold.listeners.add(listener);
        return () => hold.listeners.delete(listener);
      },
      async release() {
        if (released) return;
        released = true;
        hold.listeners.clear();
        const held = hold.entry;
        held.holds.delete(hold);
        if (disposed || held.holds.size > 0 || held.state !== 'open') return;
        await close(held);
      },
    };
    internalHold.set(rootHold, hold);
    return rootHold;
  }

  return {
    acquire(root) {
      return inTurn(async () => {
        if (disposed) throw new RootSessionsDisposedError();
        const caller = await engine.caller();
        const mapping = await open(caller, root);
        const named = entries.get(mapping.ports.context.sessionId ?? '');
        if (named === undefined) {
          const entry: Entry = {
            root,
            caller,
            mapping,
            sessionId: '',
            ended: null,
            state: 'open',
            saving: null,
            holds: new Set(),
            detach: () => {},
          };
          attach(entry, caller, mapping);
          return holdOn(entry);
        }
        // The session has holders here already. A live entry keeps its own
        // mapping; one whose stream failed takes this one.
        if (named.ended === null) mapping.close();
        else attach(named, caller, mapping);
        return holdOn(named);
      });
    },

    observe,

    held: () =>
      [...entries.values()]
        .filter((entry) => entry.holds.size > 0)
        .map((entry) => ({ ...sessionOf(entry), holders: entry.holds.size })),

    async dispose() {
      if (disposed) return;
      disposed = true;
      const live = [...entries.values()].filter((entry) => entry.ended === null);
      await Promise.all(live.map((entry) => entry.saving ?? save(entry)));
      for (const entry of entries.values()) {
        entry.detach();
        entry.mapping.close();
      }
      entries.clear();
    },
  };
}
