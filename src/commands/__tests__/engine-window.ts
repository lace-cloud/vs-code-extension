// A window over the real engine, for the module commands with no canvas
// open: the palette's module commands acting on the root `infra` of
// `repository`, a workspace of one folder, whose notices a test reads.
import { vi } from 'vitest';
import { realEngine } from '../../engine/__tests__/real-engine';
import { folder } from '../../roots/__tests__/fake-uri';
import type { RootSources } from '../../roots/authoring-roots';
import { type AuthoringApi, authoringCommands } from '../authoring-commands';
import { canvasOperations } from '../canvas-operations';

export function window(repository: string) {
  const api = {
    window: {
      showInformationMessage: vi.fn(async () => undefined),
      showWarningMessage: vi.fn(async () => undefined),
      showErrorMessage: vi.fn(async () => undefined),
      showTextDocument: vi.fn(async () => ({})),
      withProgress: (_options: unknown, task: () => Promise<unknown>) => task(),
      setStatusBarMessage: vi.fn(),
    },
    workspace: {
      workspaceFolders: [folder(repository)],
      textDocuments: [],
      openTextDocument: vi.fn(async (options: unknown) => options),
    },
    ProgressLocation: { Notification: 15 },
  };
  const [repo] = api.workspace.workspaceFolders;
  const sources: RootSources = {
    folders: () => [repo],
    activeCanvas: () => ({ folder: repo, relative: 'infra' }),
    openCanvases: () => [{ folder: repo, relative: 'infra' }],
    activeTerraformDirectory: () => undefined,
    terraformFiles: async () => [],
    pick: async () => undefined,
  };
  const { rootSessions, commands } = realEngine();
  const { table } = authoringCommands({
    api: api as unknown as AuthoringApi,
    sources,
    operations: canvasOperations({ workspace: api.workspace, rootSessions }),
    commands,
    log: { appendLine: () => {}, show: () => {} },
    offers: {
      signIn: vi.fn(),
      selectOrganization: vi.fn(),
      selectTeam: vi.fn(),
      openPortal: vi.fn(),
      install: vi.fn(),
      openRecord: vi.fn(),
    },
  });
  return { api, table };
}
