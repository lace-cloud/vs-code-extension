// Keeps each window's unsaved session frames in VS Code's encrypted secrets.
// A non-secret marker per writer makes backups discoverable without letting
// one window replace another's backup. Restoring one never removes the others.
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CanvasSource } from '@lace-cloud/canvas/engine';
import { Bundle } from '@lace-cloud/proto';
import type { RootSession, SessionAttachment } from './root-sessions';

type Secrets = {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
};
type Frame = CanvasSource & { workingDigest: string; savedDigest: string };
type Backup = { bundle: unknown; working: string; saved: string; tree: string };
type Choice = (
  root: string,
  state: 'available' | 'missing',
) => Promise<'restore' | 'discard' | 'later'>;
type Options = {
  directory: string;
  machine: string | null;
  secrets: Secrets;
  choose: Choice;
  report: (what: string) => void;
  isAlive?: (pid: number) => boolean;
};

const prefix = 'lace.recovery.';
const validId = /^[a-f0-9-]{36}$/;
const rootKey = (root: string) => createHash('sha256').update(root).digest('hex');
const key = (id: string) => `${prefix}${id}`;

function backupOf(frame: Frame): Backup {
  return {
    bundle: Bundle.toJSON(frame.bundle),
    working: frame.workingDigest,
    saved: frame.savedDigest,
    tree: frame.treeHash,
  };
}
function decode(text: string): Backup {
  const value: unknown = JSON.parse(text);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('bundle' in value) ||
    !('working' in value) ||
    !('saved' in value) ||
    !('tree' in value) ||
    typeof value.working !== 'string' ||
    !value.working ||
    typeof value.saved !== 'string' ||
    !value.saved ||
    typeof value.tree !== 'string' ||
    !value.tree
  )
    throw new Error('The recovery backup is invalid.');
  return { bundle: value.bundle, working: value.working, saved: value.saved, tree: value.tree };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    return true;
  }
}

export function createRecovery({
  directory,
  machine,
  secrets,
  choose,
  report,
  isAlive = processAlive,
}: Options) {
  const own = new Map<string, string>();
  const owner = randomUUID();
  const pending = new Map<string, Promise<void>>();
  const folder = (root: string) => join(directory, 'recovery', rootKey(root));
  async function store(root: string, id: string, backup: Backup): Promise<void> {
    await mkdir(folder(root), { recursive: true, mode: 0o700 });
    // A marker becomes visible only once its metadata is complete. Hard-link
    // publication is exclusive, so an existing owner's marker is never
    // overwritten; an interrupted temporary file is not a discoverable id.
    const temp = join(folder(root), `.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify({ owner, pid: process.pid, machine }), {
        mode: 0o600,
        flag: 'wx',
      });
      try {
        await link(temp, join(folder(root), id));
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }
    } finally {
      // Temporary metadata is not discoverable and carries no secret.
      await unlink(temp).catch(() => {});
    }
    // Publishing before storing prevents a completed secret from becoming
    // undiscoverable. A crash during its first write leaves an explicit,
    // unreadable backup rather than a marker with malformed metadata.
    await secrets.store(key(id), JSON.stringify(backup));
  }
  async function remove(root: string, id: string): Promise<void> {
    // The marker goes first: an interruption leaves an orphaned secret, never
    // a marker that promises a backup already deleted.
    try {
      await unlink(join(folder(root), id));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await secrets.delete(key(id));
  }
  async function markers(root: string): Promise<string[]> {
    try {
      return (await readdir(folder(root))).filter((id) => validId.test(id));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
  }
  async function ensureInactive(root: string, id: string): Promise<void> {
    let metadata: unknown;
    try {
      metadata = JSON.parse(await readFile(join(folder(root), id), 'utf8'));
    } catch {
      throw new Error('Cannot verify who owns a recovery backup. It was kept.');
    }
    if (
      typeof metadata !== 'object' ||
      metadata === null ||
      !('owner' in metadata) ||
      !('pid' in metadata) ||
      !('machine' in metadata) ||
      typeof metadata.owner !== 'string' ||
      !validId.test(metadata.owner) ||
      typeof metadata.pid !== 'number' ||
      !Number.isSafeInteger(metadata.pid) ||
      metadata.pid <= 0 ||
      !((typeof metadata.machine === 'string' && metadata.machine) || metadata.machine === null)
    ) {
      throw new Error('Cannot verify who owns a recovery backup. It was kept.');
    }
    if (metadata.owner === owner) return;
    if (!machine || metadata.machine !== machine || isAlive(metadata.pid)) {
      throw new Error(
        'A recovery backup may belong to another active window or process environment. It was kept. Close the other window and reopen this folder in its original environment.',
      );
    }
  }
  async function first(session: RootSession): Promise<Frame> {
    return new Promise((resolve, reject) => {
      let unsubscribe: (() => void) | undefined;
      let done = false;
      unsubscribe = session.ports.source.subscribe(
        (frame) => {
          if (!done) {
            done = true;
            resolve(frame as Frame);
            unsubscribe?.();
          }
        },
        () => {
          if (!done) {
            done = true;
            reject(new Error('The session ended before recovery.'));
            unsubscribe?.();
          }
        },
      );
      if (done) unsubscribe();
    });
  }
  return {
    // Called before the session is handed to any holder.
    async prepare(session: RootSession): Promise<void> {
      await pending.get(session.root);
      const ids = await markers(session.root);
      for (const id of ids) {
        const raw = await secrets.get(key(id));
        if (raw === undefined) {
          await ensureInactive(session.root, id);
          const choice = await choose(session.root, 'missing');
          if (choice === 'discard') {
            await remove(session.root, id);
            continue;
          }
          throw new Error('The incomplete recovery record was kept. No backup data was found.');
        }
        const backup = decode(raw);
        const current = await first(session);
        // Another window can hold the same live session. It already contains
        // this backup; neither overwrite nor remove the other window's copy.
        if (current.unsaved && current.workingDigest === backup.working) continue;
        await ensureInactive(session.root, id);
        const choice = await choose(session.root, 'available');
        if (choice === 'discard') {
          await remove(session.root, id);
          continue;
        }
        if (choice !== 'restore') throw new Error('Recovery was deferred; the backup was kept.');
        if (!current.workingDigest)
          throw new Error('This engine does not support recovery; the backup was kept.');
        const action = {
          restore: {
            bundle: Bundle.fromJSON(backup.bundle),
            captured_working_digest: backup.working,
            captured_saved_digest: backup.saved,
            captured_tree_hash: backup.tree,
            expected_working_digest: current.workingDigest,
          },
        };
        const result = await session.ports.editor.apply([action]);
        if (!result.success) {
          const detail = result.errors
            .map((error) => error.message)
            .filter(Boolean)
            .join('; ');
          throw new Error(
            `Recovery was refused${detail ? `: ${detail}` : '.'} The backup was kept.`,
          );
        }
        const mine = randomUUID();
        await store(session.root, mine, backup);
        own.set(session.root, mine);
        await remove(session.root, id);
      }
    },
    attach(session: RootSession): SessionAttachment {
      const id = own.get(session.root) ?? randomUUID();
      own.set(session.root, id);
      let queue = pending.get(session.root) ?? Promise.resolve();
      let disposed = false;
      let failure: Error | undefined;
      const unsubscribe = session.ports.source.subscribe(
        (source) => {
          if (disposed) return;
          const frame = source as Frame;
          // apply() settles only after the source has observed its revision.
          // Its replay is therefore the restored frame or a later one, even
          // when another holder edited or saved before this attachment.
          if (frame.unsaved && (!frame.workingDigest || !frame.savedDigest || !frame.treeHash)) {
            report(
              'Could not back up unsaved canvas edits: the engine did not supply recovery details.',
            );
            return;
          }
          const backup = frame.unsaved ? backupOf(frame) : undefined;
          queue = queue
            .then(async () => {
              if (backup) await store(session.root, id, backup);
              else await remove(session.root, id);
              failure = undefined;
            })
            .catch(() => {
              failure = new Error('Could not update the encrypted backup of unsaved canvas edits.');
              report('Could not update the encrypted backup of unsaved canvas edits.');
            });
          pending.set(session.root, queue);
        },
        () => {},
      );
      return {
        dispose() {
          disposed = true;
          unsubscribe();
        },
        async flush() {
          await queue;
          if (failure) throw failure;
        },
      };
    },
  };
}
