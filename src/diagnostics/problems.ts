// The Problems panel: what each held root session's canvas lists as its
// diagnostics — the session's live findings and its current report — in
// one DiagnosticCollection per authoring root, which lives exactly as long
// as the root's session is observed.
//
// This file maps and does nothing else. Which report is current, which
// findings are duplicates and what a document means are the package's
// (`foldReport`, `currentReport`, `reportDiagnostics`, `diagnosticsOf`):
// the canvas and this panel run the same fold over the same command
// results, so a report the canvas drops leaves Problems with it. A result
// the session published before this observer subscribed is replayed to it.
//
// A diagnostic's file is relative to its root, and its URI is the workspace
// folder's own URI extended by the root's path and the file, so it attaches
// to the document VS Code has open. One with no line is placed at line 1.
// One that names no file (located in the graph, such as a required input
// not set, or a command's failure) has no place in a file: it stays on the
// canvas, and Problems skips it.
import {
  type CanvasSource,
  type CommandResult,
  currentReport,
  diagnosticsOf,
  EMPTY_REPORT_FOLD,
  foldReport,
  type ReportFold,
  reportDiagnostics,
} from '@lace-cloud/canvas/engine';
import type { Diagnostic } from '@lace-cloud/proto';
import type * as vscode from 'vscode';
import type { RootSession, SessionObserver } from '../engine/root-sessions';
import { type AuthoringRoot, fileUri, rootLabel, rootOfPath } from '../roots/authoring-roots';

export type ProblemsApi = {
  languages: Pick<typeof vscode.languages, 'createDiagnosticCollection'>;
  workspace: Pick<typeof vscode.workspace, 'workspaceFolders'>;
  Range: typeof vscode.Range;
  Diagnostic: typeof vscode.Diagnostic;
  DiagnosticSeverity: typeof vscode.DiagnosticSeverity;
};

function severityOf(api: ProblemsApi, d: Diagnostic): vscode.DiagnosticSeverity {
  if (d.severity === 'error') return api.DiagnosticSeverity.Error;
  if (d.severity === 'warning') return api.DiagnosticSeverity.Warning;
  return api.DiagnosticSeverity.Information;
}

// Where in its file a diagnostic is, as VS Code counts, from 0: at line 1
// and column 1 when it names neither.
export function positionOf(at: {
  line?: number;
  column?: number;
}): [line: number, character: number] {
  return [Math.max((at.line ?? 1) - 1, 0), Math.max((at.column ?? 1) - 1, 0)];
}

type InFile = Diagnostic & { file: string };

const inFile = (d: Diagnostic): d is InFile => d.file !== undefined;

// One Lace diagnostic that names a file, as VS Code shows it, with the URI
// it is on.
export function toProblem(
  api: ProblemsApi,
  root: AuthoringRoot,
  d: InFile,
): [vscode.Uri, vscode.Diagnostic] {
  const [line, column] = positionOf(d);
  const problem = new api.Diagnostic(
    new api.Range(line, column, line, column),
    d.message,
    severityOf(api, d),
  );
  problem.source = 'lace';
  if (d.code) problem.code = d.code;
  return [fileUri(root, d.file), problem];
}

// The problems of those `diagnostics` that name a file, one entry per URI.
export function problemsByUri(
  api: ProblemsApi,
  root: AuthoringRoot,
  diagnostics: readonly Diagnostic[],
): [vscode.Uri, vscode.Diagnostic[]][] {
  const byUri = new Map<string, [vscode.Uri, vscode.Diagnostic[]]>();
  for (const d of diagnostics.filter(inFile)) {
    const [uri, problem] = toProblem(api, root, d);
    const entry = byUri.get(uri.toString());
    if (entry) entry[1].push(problem);
    else byUri.set(uri.toString(), [uri, [problem]]);
  }
  return [...byUri.values()];
}

// The observer that keeps one root session's problems in Problems.
export function problemsObserver(
  api: ProblemsApi,
  report: (what: string, error: unknown) => void,
): SessionObserver {
  return (session: RootSession) => {
    const folders = api.workspace.workspaceFolders ?? [];
    const root = rootOfPath(folders, session.root);
    if (!root) {
      report(
        `showing the problems of ${session.root}`,
        new Error(`${session.root} is under no workspace folder`),
      );
      return { dispose: () => {} };
    }
    const label = rootLabel(root, folders);
    const collection = api.languages.createDiagnosticCollection(`lace ${label}`);
    let frame: Pick<CanvasSource, 'diagnostics' | 'treeHash'> | null = null;
    let fold: ReportFold = EMPTY_REPORT_FOLD;

    const show = (): void => {
      collection.clear();
      if (!frame) return;
      const report = reportDiagnostics(currentReport(fold, frame.treeHash));
      collection.set(problemsByUri(api, root, diagnosticsOf(frame.diagnostics, report)));
    };
    const reporting =
      <A extends unknown[]>(run: (...args: A) => void) =>
      (...args: A): void => {
        try {
          run(...args);
        } catch (error) {
          report(`showing the problems of ${label}`, error);
        }
      };

    const unsubscribe = session.ports.source.subscribe(
      reporting((next: CanvasSource) => {
        frame = next;
        show();
      }),
      reporting(() => {
        frame = null;
        fold = EMPTY_REPORT_FOLD;
        show();
      }),
      reporting((result: CommandResult) => {
        fold = foldReport(fold, result);
        show();
      }),
    );
    return {
      dispose() {
        unsubscribe();
        collection.dispose();
      },
    };
  };
}
