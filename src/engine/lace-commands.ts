// The CLI commands the host runs, each named a read or a write. Whether a
// command reads or writes is a fact about the CLI command: a write can
// change something before its stream ends, a read cannot, so a read whose
// stream ended under it is to be run again and a write may have made
// changes (the package's `failureSays`). This table is where the host
// records that fact, once per command; every caller runs its command by its
// entry here. Each entry is checked against the package's command paths and
// against its own key.
import type { BoundPath } from '@lace-cloud/canvas/engine';
import type { LaceCommand } from './command-outcome';

export const LACE_COMMANDS = {
  login: { kind: 'write', path: 'login' },
  logout: { kind: 'write', path: 'logout' },
  whoami: { kind: 'read', path: 'whoami' },
  'org list': { kind: 'read', path: 'org list' },
  'org current': { kind: 'read', path: 'org current' },
  'org use': { kind: 'write', path: 'org use' },
  'team list': { kind: 'read', path: 'team list' },
  'team current': { kind: 'read', path: 'team current' },
  'team use': { kind: 'write', path: 'team use' },
  'stack list': { kind: 'read', path: 'stack list' },
  'run list': { kind: 'read', path: 'run list' },
  'connection list': { kind: 'read', path: 'connection list' },
  'registry list': { kind: 'read', path: 'registry list' },
  'registry get': { kind: 'read', path: 'registry get' },
  'registry describe': { kind: 'read', path: 'registry describe' },
  'module validate': { kind: 'write', path: 'module validate' },
  'module convert': { kind: 'write', path: 'module convert' },
  'module scan': { kind: 'read', path: 'module scan' },
  'module fmt': { kind: 'write', path: 'module fmt' },
  'module docs': { kind: 'read', path: 'module docs' },
} as const satisfies { readonly [P in BoundPath]?: LaceCommand<P> };
