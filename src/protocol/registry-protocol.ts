// The protocol between the registry's two webviews — the sidebar and
// module detail — and the extension host. Both bundles import this file, so
// the wire shape cannot drift between them. The pages are renderers: they
// draw what the host sends and say what the developer did; they reach no
// engine. Nothing here reads VS Code or the DOM.
//
// Host → page is one message, `{op: 'state', state}`, the whole state the
// page draws. Page → host messages are untrusted input: each is parsed out
// of `unknown` before any field on it is read.
import type { JsonOf } from '@lace-cloud/canvas/engine';

export type RegistryRow = JsonOf<'registry list'>['items'][number];
export type RegistryRecord = JsonOf<'registry get'>;
export type RegistryVersion = RegistryRecord['versions'][number];
export type ModuleInterface = JsonOf<'registry describe'>;

// A module as favourites, recently used and module detail name it: its
// author and name, which every version it publishes keeps.
export const moduleKey = (module: { author: string; name: string }): string =>
  `${module.author}/${module.name}`;

// What a module is called where it is shown.
export const moduleLabel = (module: { displayName: string; name: string }): string =>
  module.displayName || module.name;

// A read the host started for the page: under way, its document, or what
// the command said instead.
export type Read<T> =
  | { kind: 'loading' }
  | { kind: 'loaded'; value: T }
  | { kind: 'failed'; message: string };

// What the sidebar draws. `signedOut` (a session the server refuses) and
// `noOrganization` are the states a read's failure names by its reason;
// `failed` is any other failure.
export type SidebarState =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'noOrganization' }
  | { kind: 'failed'; message: string }
  | {
      kind: 'loaded';
      rows: readonly RegistryRow[];
      // The list filled its limit: more modules may exist than it holds.
      truncated: boolean;
      // The organization registry reads are scoped to; null for none.
      organization: string | null;
      favourites: readonly string[];
      recents: readonly string[];
      // A module's versions, read when its row is expanded.
      versions: Readonly<Record<string, Read<readonly RegistryVersion[]>>>;
    };

// What module detail draws: the row it was opened from, then the record
// and the interface as each read settles.
export type DetailState = {
  row: RegistryRow;
  record: Read<RegistryRecord>;
  describe: Read<ModuleInterface>;
};

export type ToPage<S> = { op: 'state'; state: S };

export type SidebarMessage =
  | { op: 'ready' }
  | { op: 'refresh' }
  | { op: 'signIn' }
  | { op: 'selectOrganization' }
  | { op: 'openPublishingGuide' }
  | { op: 'showDetail'; key: string }
  | { op: 'place'; key: string; version: string }
  | { op: 'toggleFavourite'; key: string }
  | { op: 'versions'; key: string };

// How the sidebar page tells its host what the developer did.
export type SendSidebarMessage = (message: SidebarMessage) => void;

export type DetailMessage = { op: 'ready' } | { op: 'place'; version: string };

// How the module detail page tells its host what the developer did.
export type SendDetailMessage = (message: DetailMessage) => void;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const BARE = ['ready', 'refresh', 'signIn', 'selectOrganization', 'openPublishingGuide'] as const;
const KEYED = ['showDetail', 'toggleFavourite', 'versions'] as const;

const among = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);

export function sidebarMessageOf(value: unknown): SidebarMessage | null {
  if (!record(value)) return null;
  const { op, key, version } = value;
  if (among(BARE, op)) return { op };
  if (typeof key !== 'string') return null;
  if (among(KEYED, op)) return { op, key };
  if (op === 'place' && typeof version === 'string') return { op, key, version };
  return null;
}

export function detailMessageOf(value: unknown): DetailMessage | null {
  if (!record(value)) return null;
  if (value.op === 'ready') return { op: 'ready' };
  if (value.op === 'place' && typeof value.version === 'string') {
    return { op: 'place', version: value.version };
  }
  return null;
}
