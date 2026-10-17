// The features activation registers, in order: every command, view and
// tool the manifest contributes is registered by one of them
// (`__tests__/manifest.test.ts`). A feature registers its commands, views
// and listeners and returns what undoes that.
import type * as vscode from 'vscode';
import { type Account, accountControls, createAccount } from './account/account';
import type { AutosaveKeeper } from './autosave/autosave-policy';
import { type CanvasPanels, createCanvasPanels } from './canvas/canvas-panels';
import { OPEN_CANVAS, openCanvas } from './canvas/open-canvas';
import { authoringCommands, type ModuleCommands } from './commands/authoring-commands';
import { type CanvasOperations, canvasOperations } from './commands/canvas-operations';
import { problemsObserver } from './diagnostics/problems';
import { type CommandsMapping, createCommandsMapping } from './engine/commands-mapping';
import { type Engine, engineControls } from './engine/engine';
import type { RootSessions } from './engine/root-sessions';
import { createRunnerHost, type RunnerHost } from './engine/runner-host';
import { moduleKey } from './protocol/registry-protocol';
import { ADD_MODULE, addModuleToCanvas } from './registry/add-module';
import { createModuleDetailPanels } from './registry/module-detail';
import { placeModule } from './registry/place-module';
import { registryMarks } from './registry/registry-marks';
import { registryReads } from './registry/registry-reads';
import { createRegistryView, REFRESH_REGISTRY, REGISTRY_VIEW } from './registry/registry-view';
import { type RootSources, startingSources, workspaceRootSources } from './roots/authoring-roots';
import {
  IMPORT_RESOURCES,
  type ImportResources,
  importResourcesCommand,
  resourceImporter,
} from './stacks/import-resources';
import { createRunOutput, type RunOutput } from './stacks/run-output';
import { type PickStack, stackPick } from './stacks/stack-pick';
import { stacksTree } from './stacks/stacks-tree';
import { createRootState, type RootState } from './state/root-state';
import { registerLaceTools } from './tools/lm-tools';
import { registerCommands } from './vscode/commands';
import { createConfirm } from './vscode/dialogs';
import { formAnswerer } from './vscode/form-answerer';
import { type OfferActions, offeringPresenter } from './vscode/offers';

// What activation builds first: the engine, the root sessions with their
// autosave, and the Output channel.
export type WindowBase = {
  api: typeof vscode;
  context: vscode.ExtensionContext;
  engine: Engine;
  rootSessions: RootSessions;
  autosave: AutosaveKeeper;
  log: vscode.OutputChannel;
  report: (what: string, error: unknown) => void;
};

// What every feature is handed: the base and the window's owners that more
// than one feature reads — what the window keeps per root, the commands
// mapping, the account, the window's one action runner with the prompts
// that answer its forms, the Output channels of its runs and what its
// notices offer, the canvas panels, how a surface names its root (a surface
// that starts a module adds its ask, `startingSources`), the one rule of
// Save and of Generate, the palette's module commands, whose Validate a
// notice about a root offers, the one stack pick, and Import Existing
// Resources, which the canvas's banner and the palette run.
export type Host = WindowBase & {
  rootState: RootState;
  commands: CommandsMapping;
  account: Account;
  runner: RunnerHost;
  runOutput: RunOutput;
  offers: OfferActions;
  panels: CanvasPanels;
  sources: RootSources;
  operations: CanvasOperations;
  modules: ModuleCommands;
  pickStack: PickStack;
  importResources: ImportResources;
};

export function windowHost(base: WindowBase): Host {
  const { api, context, engine, rootSessions, autosave, log, report } = base;
  const rootState = createRootState(context.workspaceState);
  const commands = createCommandsMapping(engine);
  const account = createAccount(commands, api, report);
  const runOutput = createRunOutput(api.window);
  const offers: OfferActions = {
    signIn: () => account.signIn(),
    selectOrganization: () => account.selectOrganization(),
    selectTeam: () => account.selectTeam(),
    openPortal: ({ url }) => api.env.openExternal(api.Uri.parse(url)),
    install: ({ url }) => api.env.openExternal(api.Uri.parse(url)),
    openRecord: ({ url }) => api.env.openExternal(api.Uri.parse(url)),
  };
  const panels = createCanvasPanels({
    api,
    extensionUri: context.extensionUri,
    engine,
    rootSessions,
    rootState,
    confirm: createConfirm(api.window),
    pageFocus: autosave.pageFocus,
    offers,
    // The module commands and Import Existing Resources name roots through
    // the panels, so they are built after them; a page's notice or banner
    // action comes long after both exist.
    validate: (root) => modules.validate(root),
    importResources: (root) => importResources(root),
    generated: (root, files) => modules.generated(root, files),
    report,
  });
  const sources = workspaceRootSources(api, {
    activeCanvas: panels.activeRoot,
    openCanvases: panels.roots,
  });
  const operations = canvasOperations({ workspace: api.workspace, rootSessions });
  const modules = authoringCommands({
    api,
    sources,
    operations,
    commands,
    log,
    offers,
  });
  const runner = createRunnerHost({
    commands: () => commands.anywhere(),
    presenter: offeringPresenter({
      api,
      actions: offers,
      confirm: createConfirm(api.window),
      validate: modules.validate,
      sources,
      report,
    }),
    answerer: formAnswerer({ api, commands, offers, sources, report }),
    onRunLog: runOutput.append,
  });
  const pickStack = stackPick({ api, commands, rootState, sources, offers });
  const importResources = resourceImporter({ api, sources, runner, pickStack });
  return {
    ...base,
    rootState,
    commands,
    account,
    runner,
    runOutput,
    offers,
    panels,
    sources,
    operations,
    modules,
    pickStack,
    importResources,
  };
}

export type Feature = (host: Host) => vscode.Disposable;

const disposingAll = (disposables: readonly vscode.Disposable[]): vscode.Disposable => ({
  dispose() {
    for (const disposable of disposables) disposable.dispose();
  },
});

// Lace: Open Canvas, and the canvas panels' lifetime.
function canvas({ api, panels, sources }: Host): vscode.Disposable {
  return disposingAll([
    ...registerCommands(api, {
      [OPEN_CANVAS]: openCanvas(panels, startingSources(api.window, sources), api.window),
    }),
    panels,
  ]);
}

// The Problems panel: every held session's diagnostics.
function problems({ api, rootSessions, report }: Host): vscode.Disposable {
  return rootSessions.observe(problemsObserver(api, report));
}

// Save, Generate, Validate, Convert, Format, Scan and Generate Docs.
function moduleCommands({ api, modules }: Host): vscode.Disposable {
  return disposingAll(registerCommands(api, modules.table));
}

// The registry sidebar, module detail and Add Module to Canvas.
function registry(host: Host): vscode.Disposable {
  const { api, context, report } = host;
  const reads = registryReads(host.commands);
  const marks = registryMarks(context.globalState);
  const place = placeModule({
    api,
    sources: startingSources(api.window, host.sources),
    panels: host.panels,
    rootSessions: host.rootSessions,
    log: host.log,
    placed: (module) => marks.placed(moduleKey(module)),
  });
  const details = createModuleDetailPanels({
    api,
    extensionUri: context.extensionUri,
    reads,
    place,
    report,
  });
  const view = createRegistryView({
    api,
    extensionUri: context.extensionUri,
    reads,
    marks,
    account: host.account,
    place,
    showDetail: details.show,
    report,
  });
  return disposingAll([
    api.window.registerWebviewViewProvider(REGISTRY_VIEW, view),
    ...registerCommands(api, {
      [REFRESH_REGISTRY]: view.refresh,
      [ADD_MODULE]: addModuleToCanvas({ api, reads, place, offers: host.offers }),
    }),
    view,
    details,
  ]);
}

// Sign In, Sign Out, Select Organization and Select Team, the status bar
// item showing the selection, and the lifetime of the window's account.
function accountCommands({ api, account, commands, offers, report }: Host): vscode.Disposable {
  return disposingAll([accountControls(api, account, commands, offers, report), account]);
}

// The Stacks tree, Lace: Import Existing Resources, and the lifetime of the
// window's runner and its runs' Output channels.
function stacks(host: Host): vscode.Disposable {
  const { api, sources, runner, runOutput } = host;
  return disposingAll([
    stacksTree({ ...host, validate: host.modules.validate }),
    ...registerCommands(api, {
      [IMPORT_RESOURCES]: importResourcesCommand(api.window, sources, host.importResources),
    }),
    runner,
    runOutput,
  ]);
}

// The Lace tools in VS Code's chat, run by the developer's own model. A host
// without the Language Model Tools API runs without them.
function tools(host: Host): vscode.Disposable {
  const { api, panels, rootSessions, operations, commands, sources } = host;
  return registerLaceTools(api, { panels, rootSessions, operations, commands }, sources);
}

export const FEATURES: readonly Feature[] = [
  ({ api, engine, log }) => engineControls(api, engine, log),
  canvas,
  problems,
  moduleCommands,
  registry,
  accountCommands,
  stacks,
  tools,
];
