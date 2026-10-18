// The module commands of the palette. Each acts on the root `nameRoot`
// names and says which in its progress or its result.
//
// Save and Generate run the canvas operations' one rule each, as the chat
// tools do. Generate shows its progress, by the stage the engine reports,
// then what it did to the tree as the package reads its success
// (`generatedTree`), the files it changed and removed, with Show Changes,
// which opens Source Control, or the engine's refusal by its reason. A
// Generate the canvas's own button ran ends with the same notice
// (`generated`).
//
// Validate, Convert, Format, Scan, Lock Providers and Generate Docs take no
// session and run through the commands mapping in that root, as the same
// command typed in a terminal there would: the engine runs it on the root's session's
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
// unsaved typing is left behind the rewrite. Validate, Scan, Lock Providers
// and Generate Docs rewrite none of it and read the files as they are on
// disk, as the same command in a terminal does, the chat's validate tool and
// the canvas's Validate too: one operation reads the same files by every
// trigger, and reading them saves nothing into the tree. Convert rewrites the
// root's Terraform in place into Lace style and asks nothing first, as the
// canvas's Convert does: the root is a git repository, and git shows the
// rewrite as any other change. An open canvas of the root picks the
// rewritten Terraform up live. A Convert names the lockfile its lock of the
// tree wrote; a tree it changed whose providers did not lock is no change to
// commit yet (a stack's apply refuses a tree with no lockfile), so it says so
// and offers Lock Providers. Lock Providers (`module lock`) names the
// lockfile it wrote and how many providers it pinned; Scan names the tool
// that ran, at the version the CLI reports.
//
// Where a report lands follows its one signal. With the root's session held
// in this window, the engine publishes the result to the session and the
// Problems panel shows it as the canvas does; without one, the report is
// the result of a command that was run: a notification, and the Output
// channel on Show Report. Generate Docs writes nothing into the tree: its
// markdown opens in an untitled editor, and the developer's save is the
// write.

import { relative } from 'node:path';
import {
  type ArgsOf,
  type BoundPath,
  type CommandFailure,
  diagnosticsOfDocument,
  type GeneratedTree,
  type GenerateEvent,
  type GenerateStage,
  generatedTree,
  type JsonOf,
  Reason,
} from '@lace-cloud/canvas/engine';
import type { Diagnostic } from '@lace-cloud/proto';
import type * as vscode from 'vscode';
import { saveFailureText } from '../autosave/autosave-policy';
import { commandOutcome } from '../engine/command-outcome';
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
import { notice, type OfferActions, offersFor } from '../vscode/offers';
import { type CanvasOperations, notDoneText } from './canvas-operations';
import { saveBuffersBefore } from './terraform-buffers';

export const SAVE_CANVAS = 'lace.save';
export const GENERATE_CANVAS = 'lace.generate';
export const VALIDATE_MODULE = 'lace.validateModule';
export const CONVERT_MODULE = 'lace.convertModule';
export const FORMAT_MODULE = 'lace.formatModule';
export const SCAN_MODULE = 'lace.scanModule';
export const GENERATE_DOCS = 'lace.generateDocs';
export const LOCK_MODULE = 'lace.lockModule';

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
const LOCK_PROVIDERS = 'Lock Providers';

// The progress of a Generate, by the stage the engine reports it at.
const STAGES: Readonly<Record<GenerateStage, string>> = {
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

type Lock = JsonOf<'module lock'>;

// The lockfile a lock wrote, named from the root it locked as the files a
// command wrote are: the CLI writes it beside the tree.
const lockfileOf = ({ path, lockfile }: Lock): string => relative(path, lockfile);

// What a Convert of the root `label` changed: the files it wrote and the
// files it removed, the lockfile its lock of the tree wrote, then the
// verdict of the validate it ended with, when that validate reached one.
export function convertedText(
  label: string,
  { changed, written, removed, lock, validate }: JsonOf<'module convert'>,
): string {
  if (!changed) return `${label} is in Lace style already, so Convert wrote nothing`;
  const wrote = `wrote ${written.join(', ')}`;
  const deleted = removed.length === 0 ? '' : `; removed ${removed.join(', ')}`;
  const locked =
    lock === null
      ? ''
      : `; locked ${count(lock.providers.length, 'provider')} in ${lockfileOf(lock)}`;
  const verdict = validate.verdict === undefined ? '' : `; ${validate.verdict}`;
  return `Converted ${label}: ${wrote}${deleted}${locked}${verdict}`;
}

// What a scan of the root `label` ran: the tool, at the version the CLI
// reports for it, when it reports one.
function scannedText(label: string, { tool }: JsonOf<'module scan'>): string {
  return `Scanned ${label} with ${tool.name}${tool.version === null ? '' : ` ${tool.version}`}`;
}

// What a Generate of the root `label` did to the tree, as the package reads
// it (`generatedTree`): the files whose bytes it changed, the source tf it
// removed, and how many of the files it wrote it left as they were; or that
// it changed nothing.
function generatedText(
  label: string,
  { changed, removed, unchanged, treeChanged }: GeneratedTree,
): string {
  if (!treeChanged) return `Generated the Terraform of ${label}: nothing changed.`;
  const said = [
    ...(changed.length > 0 ? [`changed ${changed.join(', ')}`] : []),
    ...(removed.length > 0 ? [`removed ${removed.join(', ')}`] : []),
    ...(unchanged > 0 ? [`${count(unchanged, 'file')} unchanged`] : []),
  ];
  return `Generated the Terraform of ${label}: ${said.join('; ')}.`;
}

export type ModuleCommands = {
  // The palette's commands, by id; each acts on the root `nameRoot` names
  // from what it is pointed at.
  table: Record<string, (pointedAt?: vscode.Uri) => Promise<void>>;
  // Lace: Validate Module on `root`.
  validate: (root: AuthoringRoot) => Promise<void>;
  // What a Generate of `root` that succeeded shows, wherever it ran, from
  // what the package reads of the tree it wrote.
  generated: (root: AuthoringRoot, tree: GeneratedTree) => Promise<void>;
};

export function authoringCommands(options: AuthoringCommandsOptions): ModuleCommands {
  const { api, sources, operations, commands, log, offers } = options;

  const named = (verb: string, pointedAt?: vscode.Uri): Promise<AuthoringRoot | undefined> =>
    rootToAct(sources, api.window, verb, pointedAt);
  const labelOf = (root: AuthoringRoot): string => rootLabel(root, sources.folders());

  async function save(pointedAt?: vscode.Uri): Promise<void> {
    const root = await named('save', pointedAt);
    if (root) await saveRoot(root);
  }

  async function saveRoot(root: AuthoringRoot): Promise<void> {
    try {
      const outcome = await operations.save(root, (hold) => hold.ports.editor.save());
      if (outcome.kind === 'done') {
        api.window.setStatusBarMessage(`Lace: saved the canvas of ${labelOf(root)}`, 5000);
      } else {
        void api.window.showInformationMessage(notDoneText(root, sources.folders(), outcome));
      }
    } catch (error) {
      void api.window.showErrorMessage(saveFailureText(labelOf(root), error));
    }
  }

  // A Generate of `root` succeeded: it says what it did to the tree, and
  // Show Changes opens Source Control, where git shows the diff. A Generate
  // that changed and removed no file has no change to show.
  async function generated(root: AuthoringRoot, tree: GeneratedTree): Promise<void> {
    const said = generatedText(labelOf(root), tree);
    if (!tree.treeChanged) {
      void api.window.showInformationMessage(said);
      return;
    }
    const answer = await api.window.showInformationMessage(said, SHOW_CHANGES);
    if (answer === SHOW_CHANGES) await api.commands.executeCommand('workbench.view.scm');
  }

  async function generate(pointedAt?: vscode.Uri): Promise<void> {
    const root = await named('generate', pointedAt);
    if (!root) return;
    const label = labelOf(root);
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
      void api.window.showErrorMessage(notDoneText(root, sources.folders(), outcome));
      return;
    }
    const closing = outcome.value;
    if (closing?.type === 'success') return generated(root, generatedTree(closing));
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

  // Names the root and runs `lace <path>` in it under a progress
  // notification that names the root; a failure is shown where the developer
  // acted, a document goes to `show`. The root's unsaved Terraform buffers
  // are saved first when the CLI declares the command a rewrite
  // (`saveBuffersBefore`). Nothing runs when no root is named or a buffer
  // did not save.
  function inRoot<P extends BoundPath>(
    { verb, doing, path, args }: { verb: string; doing: string; path: P; args: ArgsOf<P> },
    show: (root: AuthoringRoot, label: string, document: JsonOf<P>) => Promise<void> | void,
  ): (pointedAt?: vscode.Uri) => Promise<void> {
    return async (pointedAt) => {
      const root = await named(verb, pointedAt);
      if (!root) return;
      const label = labelOf(root);
      if (!(await saveBuffersBefore(api.workspace, root, path))) {
        void api.window.showErrorMessage(
          `A Terraform file in ${label} did not save, so Lace did not ${verb} it.`,
        );
        return;
      }
      const outcome = await api.window.withProgress(
        { location: api.ProgressLocation.Notification, title: `Lace: ${doing} ${label}` },
        async () => commandOutcome(await commands.at(rootPath(root)), path, args),
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
      offersFor(failure),
    );
  }

  // A report of the root: in Problems through the root's session when this
  // window holds it, else a notification with Show Report. `undone`, what
  // the command left to do before the tree is committed, is said after the
  // report at warn, with the button that does it, wherever the report lands.
  async function showReport(
    root: AuthoringRoot,
    summary: string,
    diagnostics: readonly Diagnostic[],
    undone?: { said: string; button: string; run: () => Promise<void> },
  ): Promise<void> {
    const held = operations.held(root);
    if (held && undone === undefined) {
      api.window.setStatusBarMessage(`Lace: ${summary}; the report is in Problems`, 5000);
      return;
    }
    const report = held
      ? `${summary}; the report is in Problems.`
      : `${summary}, ${count(diagnostics.length, 'diagnostic')}.`;
    const text = undone === undefined ? report : `${report} ${undone.said}`;
    const buttons = [...(undone ? [undone.button] : []), ...(held ? [] : [SHOW_REPORT])];
    const answer = await (diagnostics.length === 0 && undone === undefined
      ? api.window.showInformationMessage(text, ...buttons)
      : api.window.showWarningMessage(text, ...buttons));
    if (undone && answer === undone.button) {
      await undone.run();
      return;
    }
    if (answer !== SHOW_REPORT) return;
    for (const line of reportLines(root, text, diagnostics)) log.appendLine(line);
    log.show(true);
  }

  const table: Record<string, (pointedAt?: vscode.Uri) => Promise<void>> = {
    [SAVE_CANVAS]: save,
    [GENERATE_CANVAS]: generate,
    [VALIDATE_MODULE]: inRoot(
      { verb: 'validate', doing: 'validating', path: 'module validate', args: {} },
      (root, label, document) =>
        showReport(root, validatedText(label, document), diagnosticsOfDocument(document)),
    ),
    [CONVERT_MODULE]: inRoot(
      { verb: 'convert', doing: 'converting', path: 'module convert', args: {} },
      (root, label, document) =>
        showReport(
          root,
          convertedText(label, document),
          diagnosticsOfDocument(document),
          document.changed && document.lock === null
            ? {
                said: "The tree's providers did not lock: lock them before you commit it.",
                button: LOCK_PROVIDERS,
                run: () => lock(root),
              }
            : undefined,
        ),
    ),
    [SCAN_MODULE]: inRoot(
      { verb: 'scan', doing: 'scanning', path: 'module scan', args: {} },
      (root, label, document) =>
        showReport(root, scannedText(label, document), diagnosticsOfDocument(document)),
    ),
    [LOCK_MODULE]: inRoot(
      {
        verb: 'lock the providers of',
        doing: 'locking the providers of',
        path: 'module lock',
        args: {},
      },
      (_root, label, document) => {
        void api.window.showInformationMessage(
          `Locked ${count(document.providers.length, 'provider')} of ${label} in ${lockfileOf(document)}.`,
        );
      },
    ),
    [FORMAT_MODULE]: inRoot(
      { verb: 'format', doing: 'formatting', path: 'module fmt', args: {} },
      (_root, label, { changed }) => {
        void api.window.showInformationMessage(
          changed.length === 0
            ? `${label} is formatted; nothing changed.`
            : `Formatted ${count(changed.length, 'file')} in ${label}: ${changed.join(', ')}.`,
        );
      },
    ),
    [GENERATE_DOCS]: inRoot(
      { verb: 'document', doing: 'generating the docs of', path: 'module docs', args: {} },
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
  const lock = (root: AuthoringRoot) => table[LOCK_MODULE](rootUri(root));
  return { table, validate, generated };
}
