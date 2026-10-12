// A stand-in for the VS Code surface Problems uses: diagnostic collections
// whose current entries a test reads, and the value classes they hold.
import type * as vscode from 'vscode';
import type { ProblemsApi } from '../problems';

class Range {
  constructor(
    readonly startLine: number,
    readonly startCharacter: number,
    readonly endLine: number,
    readonly endCharacter: number,
  ) {}
}

class Diagnostic {
  source?: string;
  code?: string;
  constructor(
    readonly range: Range,
    readonly message: string,
    readonly severity: number,
  ) {}
}

export type FakeCollection = {
  name: string;
  disposed: boolean;
  // The diagnostics per URI string, as the collection holds them now.
  entries: Map<string, Diagnostic[]>;
};

export function fakeProblemsApi(folders: readonly vscode.WorkspaceFolder[]) {
  const collections: FakeCollection[] = [];
  const api = {
    languages: {
      createDiagnosticCollection: (name: string) => {
        const collection: FakeCollection = { name, disposed: false, entries: new Map() };
        collections.push(collection);
        return {
          clear: () => collection.entries.clear(),
          set: (entries: [vscode.Uri, Diagnostic[]][]) => {
            for (const [uri, diagnostics] of entries) {
              collection.entries.set(uri.toString(), diagnostics);
            }
          },
          dispose: () => {
            collection.disposed = true;
            collection.entries.clear();
          },
        };
      },
    },
    workspace: { workspaceFolders: folders },
    Range,
    Diagnostic,
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  } as unknown as ProblemsApi;
  return {
    api,
    collections,
    // The live collections' entries, all roots together.
    shown: () =>
      Object.fromEntries(
        collections
          .filter((c) => !c.disposed)
          .flatMap((c) => [...c.entries])
          .map(([uri, ds]) => [uri, ds.map((d) => d.message)]),
      ),
  };
}
