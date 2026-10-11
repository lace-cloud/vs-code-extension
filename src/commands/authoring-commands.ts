// The module commands of the palette. Each acts on the root `nameRoot`
// names and says which in its progress or its result.
//
// Save and Generate run the canvas operations' one rule each, as the chat
// tools do. Generate shows its progress, then the files it wrote with Show
// Changes, which opens Source Control, or the engine's refusal by its
// reason. A Generate the canvas's own button ran ends with the same notice
// (`generated`).
//
// Validate, Convert, Format, Scan and Generate Docs take no session and
// run through the commands mapping in that root, as the same command typed
// in a terminal there would: the engine runs it on the root's session's
// Workspace when the root has one and on the directory otherwise, and
// creates no canvas state. Validate and Convert do not go through the
// window's runner: the package's bindings for them hand the presenter a
// verdict line and no document, and with no session the report is the
// command's document (below). Validate is also what a notice about a root
// offers, on that root: `validate`.
//
// Format and Convert write the root's Terraform, so each first saves the
// root's Terraform files that have unsaved changes in an editor, as
// Generate does: the command writes over what the developer sees, and no
// unsaved typing is left behind the rewrite. Validate, Scan and Generate
// Docs write nothing there and read the files as they are on disk, as the
// same command in a terminal does, the chat's validate tool and the
// canvas's Validate too: one operation reads the same files by every
// trigger, and a read writes nothing into the tree. Convert rewrites the
// root's Terraform in place into Lace style and asks nothing first, as the
// canvas's Convert does: the root is a git repository, and git shows the
// rewrite as any other change. An open canvas of the root picks the
// rewritten Terraform up live.
//
// Where a report lands follows its one signal. With the root's session held
// in this window, the engine publishes the result to the session and the
// Problems panel shows it as the canvas does; without one, the report is
// the result of a command that was run: a notification, and the Output
// channel on Show Report. Generate Docs writes nothing into the tree: its
// markdown opens in an untitled editor, and the developer's save is the
// write.
import {
  type BoundPath,
  type CommandFailure,
  type CommandsPort,
  diagnosticsOfDocument,
  type GenerateEvent,
  type JsonOf,
  Reason,
} from '@lace-cloud/canvas/engine';
import type { Diagnostic } from '@lace-cloud/proto';
import type * as vscode from 'vscode';
import { saveFailureText } from '../autosave/autosave-policy';
import { type CommandOutcome, commandOutcome } from '../engine/command-outcome';
import type { CommandsMapping } from '../engine/commands-mapping';
import {
  type AuthoringRoot,
  fileUri,
  type RootSources,
  rootLabel,
  rootPath,
  rootToAct,
  rootUri,
} from '../roots/authoring-roots';
import { notice, type OfferActions } from '../vscode/offers';
import { type CanvasOperations, notDoneText } from './canvas-operations';
import { saveTerraformBuffers } from './terraform-buffers';

export const SAVE_CANVAS = 'lace.save';
export const GENERATE_CANVAS = 'lace.generate';
export const VALIDATE_MODULE = 'lace.validateModule';
export const CONVERT_MODULE = 'lace.convertModule';
export const FORMAT_MODULE = 'lace.formatModule';
export const SCAN_MODULE = 'lace.scanModule';
export const GENERATE_DOCS = 'lace.generateDocs';

export type AuthoringApi = {
  window: Pick<
    typeof vscode.window,
    | 'showInformationMessage'
    | 'showWarningMessage'
    | 'showErrorMessage'
    | 'showTextDocument'
    | 'withProgress'
    | 'setStatusBarMessage'
  >;
  workspace: Pick<typeof vscode.workspace, 'textDocuments' | 'openTextDocument'>;
  commands: Pick<typeof vscode.commands, 'executeCommand'>;
  ProgressLocation: Pick<typeof vscode.ProgressLocation, 'Notification'>;
};

export type AuthoringCommandsOptions = {
  api: AuthoringApi;
  sources: RootSources;
  operations: CanvasOperations;
  commands: Pick<CommandsMapping, 'at'>;
  log: Pick<vscode.OutputChannel, 'appendLine' | 'show'>;
  // What a failure's notice offers to do about it.
  offers: OfferActions;
};

const SHOW_REPORT = 'Show Report';
const SHOW_CHANGES = 'Show Changes';
const SAVE = 'Save';

const STAGES: Readonly<Record<Extract<GenerateEvent, { type: 'progress' }>['stage'], string>> = {
  generating: 'writing the Terraform',
  validating: 'validating the written Terraform',
};

// A report's lines for the Output channel: what ran where and what it said,
// then each diagnostic at its file and line, as a link the channel opens.
export function reportLines(
  root: AuthoringRoot,
  heading: string,
  diagnostics: readonly Diagnostic[],
): string[] {
  const at = (d: Diagnostic): string =>
    d.file === undefined
      ? rootPath(root)
      : `${fileUri(root, d.file).fsPath}:${d.line ?? 1}:${d.column ?? 1}`;
  return [
    heading,
    ...diagnostics.map(
      (d) => `  ${at(d)}: ${d.severity}${d.code ? ` [${d.code}]` : ''}: ${d.message}`,
    ),
  ];
}

const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

// What a Validate of the root `label` reached: its verdict, when its run
// reached one. A run that stopped short of a verdict (a tree Lace's rules
// or the parse refused) has no verdict, and its diagnostics are its report.
function validatedText(label: string, { verdict }: JsonOf<'module validate'>): string {
  return verdict === undefined ? `Validated ${label}` : `Validated ${label}: ${verdict}`;
}

// What a Convert of the root `label` changed: the files it wrote and the
// files it removed, then the verdict of the validate it ended with, when
// that validate reached one.
export function convertedText(
  label: string,
  { changed, written, removed, validate }: JsonOf<'module convert'>,
): string {
  if (!changed) return `${label} is in Lace style already, so Convert wrote nothing`;
  const wrote = `wrote ${written.join(', ')}`;
  const deleted = removed.length === 0 ? '' : `; removed ${removed.join(', ')}`;
  const verdict = validate.verdict === undefined ? '' : `; ${validate.verdict}`;
  return `Converted ${label}: ${wrote}${deleted}${verdict}`;
}

export type ModuleCommands = {
  // The palette's commands, by id; each acts on the root `nameRoot` names
  // from what it is pointed at.
  table: Record<string, (pointedAt?: vscode.Uri) => Promise<void>>;
  // Lace: Validate Module on `root`.
  validate: (root: AuthoringRoot) => Promise<void>;
  // What a Generate of `root` that wrote `written` shows, wherever it ran.
  generated: (root: AuthoringRoot, written: readonly string[]) => Promise<void>;
};

export function authoringCommands(options: AuthoringCommandsOptions): ModuleCommands {
  const { api, sources, operations, commands, log, offers } = options;

  const named = (verb: string, pointedAt?: vscode.Uri): Promise<AuthoringRoot | undefined> =>
    rootToAct(sources, api.window, verb, pointedAt);

  async function save(pointedAt?: vscode.Uri): Promise<void> {
    const root = await named('save', pointedAt);
    if (root) await saveRoot(root);
  }

  async function saveRoot(root: AuthoringRoot): Promise<void> {
    try {
      const outcome = await operations.save(root, (hold) => hold.ports.editor.save());
      if (outcome.kind === 'done') {
        api.window.setStatusBarMessage(`Lace: saved the canvas of ${rootLabel(root)}`, 5000);
      } else {
        void api.window.showInformationMessage(notDoneText(root, outcome));
      }
    } catch (error) {
      void api.window.showErrorMessage(saveFailureText(rootLabel(root), error));
    }
  }

  // A Generate of `root` wrote `written`: Show Changes opens Source Control,
  // where git shows the diff.
  async function generated(root: AuthoringRoot, written: readonly string[]): Promise<void> {
    const answer = await api.window.showInformationMessage(
      `Generated the Terraform of ${rootLabel(root)}: ${written.join(', ')}.`,
      SHOW_CHANGES,
    );
    if (answer === SHOW_CHANGES) await api.commands.executeCommand('workbench.view.scm');
  }

  async function generate(pointedAt?: vscode.Uri): Promise<void> {
    const root = await named('generate', pointedAt);
    if (!root) return;
    const label = rootLabel(root);
    const outcome = await api.window.withProgress(
      { location: api.ProgressLocation.Notification, title: `Lace: generating ${label}` },
      (progress) =>
        operations.generate(root, async (hold) => {
          let closing: Exclude<GenerateEvent, { type: 'progress' }> | undefined;
          for await (const event of hold.ports.editor.generate()) {
            if (event.type === 'progress') progress.report({ message: STAGES[event.stage] });
            else closing = event;
          }
          return closing;
        }),
    );
    if (outcome.kind !== 'done') {
      void api.window.showErrorMessage(notDoneText(root, outcome));
      return;
    }
    const closing = outcome.value;
    if (closing?.type === 'success') return generated(root, closing.written);
    if (closing?.reason === Reason.REASON_UNSAVED) {
      const answer = await api.window.showErrorMessage(
        `${label} has unsaved canvas edits: Lace generates the saved canvas.`,
        SAVE,
      );
      if (answer === SAVE) await saveRoot(root);
      return;
    }
    void api.window.showErrorMessage(
      `Lace did not generate ${label}: ${closing?.message ?? 'the engine ended the Generate without an outcome'}`,
    );
  }

  // Names the root and runs one command in it under a progress notification
  // that names the root, first saving its buffers when the command `writes`
  // the root's Terraform; a failure is shown where the developer acted, a
  // document goes to `show`. Nothing runs when no root is named or a buffer
  // did not save.
  function inRoot<P extends BoundPath>(
    { verb, doing, writes }: { verb: string; doing: string; writes: boolean },
    run: (commands: CommandsPort) => Promise<CommandOutcome<P>>,
    show: (root: AuthoringRoot, label: string, document: JsonOf<P>) => Promise<void> | void,
  ): (pointedAt?: vscode.Uri) => Promise<void> {
    return async (pointedAt) => {
      const root = await named(verb, pointedAt);
      if (!root) return;
      const label = rootLabel(root);
      if (writes && !(await saveTerraformBuffers(api.workspace, root))) {
        void api.window.showErrorMessage(
          `A Terraform file in ${label} did not save, so Lace did not ${verb} it.`,
        );
        return;
      }
      const outcome = await api.window.withProgress(
        { location: api.ProgressLocation.Notification, title: `Lace: ${doing} ${label}` },
        async () => run(await commands.at(rootPath(root))),
      );
      if (outcome.kind === 'failure') await showFailure(root, outcome.failure);
      else await show(root, label, outcome.document);
    };
  }

  // A failure the command run in `root` reported: its message, with the
  // ways out its reason names, read from the failure document. Validate
  // (`source_refused`: Terraform the command cannot represent as written)
  // validates that root, whose report names what is refused.
  async function showFailure(root: AuthoringRoot, failure: CommandFailure): Promise<void> {
    await notice(
      api,
      { ...offers, validate: () => validate(root) },
      'error',
      failure.message,
      failure,
    );
  }

  // A report of the root: in Problems through the root's session when this
  // window holds it, else a notification with Show Report.
  async function showReport(
    root: AuthoringRoot,
    summary: string,
    diagnostics: readonly Diagnostic[],
  ): Promise<void> {
    if (operations.held(root)) {
      api.window.setStatusBarMessage(`Lace: ${summary}; the report is in Problems`, 5000);
      return;
    }
    const text = `${summary}, ${count(diagnostics.length, 'diagnostic')}.`;
    const answer = await (diagnostics.length === 0
      ? api.window.showInformationMessage(text, SHOW_REPORT)
      : api.window.showWarningMessage(text, SHOW_REPORT));
    if (answer !== SHOW_REPORT) return;
    for (const line of reportLines(root, text, diagnostics)) log.appendLine(line);
    log.show(true);
  }

  const table: Record<string, (pointedAt?: vscode.Uri) => Promise<void>> = {
    [SAVE_CANVAS]: save,
    [GENERATE_CANVAS]: generate,
    [VALIDATE_MODULE]: inRoot(
      { verb: 'validate', doing: 'validating', writes: false },
      (port) => commandOutcome(port, 'module validate', {}),
      (root, label, document) =>
        showReport(root, validatedText(label, document), diagnosticsOfDocument(document)),
    ),
    [CONVERT_MODULE]: inRoot(
      { verb: 'convert', doing: 'converting', writes: true },
      (port) => commandOutcome(port, 'module convert', {}),
      (root, label, document) =>
        showReport(root, convertedText(label, document), diagnosticsOfDocument(document)),
    ),
    [SCAN_MODULE]: inRoot(
      { verb: 'scan', doing: 'scanning', writes: false },
      (port) => commandOutcome(port, 'module scan', {}),
      (root, label, document) =>
        showReport(root, `Scanned ${label}`, diagnosticsOfDocument(document)),
    ),
    [FORMAT_MODULE]: inRoot(
      { verb: 'format', doing: 'formatting', writes: true },
      (port) => commandOutcome(port, 'module fmt', {}),
      (_root, label, { changed }) => {
        void api.window.showInformationMessage(
          changed.length === 0
            ? `${label} is formatted; nothing changed.`
            : `Formatted ${count(changed.length, 'file')} in ${label}: ${changed.join(', ')}.`,
        );
      },
    ),
    [GENERATE_DOCS]: inRoot(
      { verb: 'document', doing: 'generating the docs of', writes: false },
      (port) => commandOutcome(port, 'module docs', {}),
      async (_root, _label, { markdown }) => {
        const document = await api.workspace.openTextDocument({
          language: 'markdown',
          content: markdown,
        });
        await api.window.showTextDocument(document);
      },
    ),
  };
  const validate = (root: AuthoringRoot) => table[VALIDATE_MODULE](rootUri(root));
  return { table, validate, generated };
}
