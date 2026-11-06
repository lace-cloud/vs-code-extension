// Placing a registry module on a canvas: the sidebar's "+", module
// detail's Add to Canvas and Lace: Add Module to Canvas. The root is the one
// `nameRoot` names, which in a workspace that holds no module is the
// workspace folder the module starts in. Its canvas panel is created or
// revealed first, without taking focus, so the developer has the place that
// shows the edit and the session never rests on this call alone; the call
// then holds the session for its own duration and applies one
// `place_module`.
//
// A placement the engine refuses says why by its reason: signed out offers
// Sign In; any other names the module and the reason, with Show Details on
// the engine's full message in the Output channel. Every failure is shown
// where the developer acted; the returned function never rejects.
import { type Action, ConnectError, type EditorPort, reasonWire } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import { SIGN_IN } from '../account/account';
import type { CanvasPanels } from '../canvas/canvas-panels';
import { type ByReason, byReason, failureText } from '../engine/command-outcome';
import type { RootSessions } from '../engine/root-sessions';
import {
  isDeprecated,
  type Latest,
  loaded,
  moduleKey,
  newestPublishedNote,
  versionTitle,
} from '../protocol/registry-protocol';
import { rootLabel, rootPath, rootToAct, type StartingSources } from '../roots/authoring-roots';
import { asRead, type RegistryReads } from './registry-reads';

export type PlacedModule = { author: string; name: string; version: string };

// Places a module at the status the registry lists its version with, which the
// engine is not sent, and, when the caller has read it, the module's latest.
export type Place = (module: PlacedModule, status: string, latest?: Latest) => Promise<void>;

export type PlaceApi = {
  window: Pick<
    typeof vscode.window,
    'showInformationMessage' | 'showErrorMessage' | 'withProgress' | 'setStatusBarMessage'
  >;
  commands: Pick<typeof vscode.commands, 'executeCommand'>;
  ProgressLocation: Pick<typeof vscode.ProgressLocation, 'Notification'>;
};

export type PlaceOptions = {
  api: PlaceApi;
  sources: StartingSources;
  panels: Pick<CanvasPanels, 'ensure'>;
  rootSessions: Pick<RootSessions, 'acquire'>;
  reads: Pick<RegistryReads, 'get'>;
  log: Pick<vscode.OutputChannel, 'appendLine' | 'show'>;
  // Called once the module is on the canvas.
  placed: (module: PlacedModule) => Promise<void>;
};

// Why the engine refused a placement, by the refusal's reason when Lace
// decided it,
export const PLACEMENT_REFUSALS: ByReason<string> = {
  not_lace_form: 'it is not in Lace form',
  hash_mismatch: 'its published tree does not match the hash the registry recorded',
  registry_unavailable: 'the registry could not be reached',
};

// and by the API's own code when the API decided it.
export const PLACEMENT_API_REFUSALS: Readonly<Record<string, string>> = {
  not_found: 'the registry has no such module, or it is not visible to you',
  version_not_found: 'the registry has no such version of it',
  forbidden: 'you may not use it',
};

const SHOW_DETAILS = 'Show Details';
const SIGN_IN_ACTION = 'Sign In';
const UNREAD_NEWEST = 'could not read the newest published version';

export function placeModule(options: PlaceOptions): Place {
  const { api, sources, panels, rootSessions, reads, log, placed } = options;

  async function refused(named: string, label: string, error: ConnectError): Promise<void> {
    const reason = error.apiCode ?? reasonWire(error.reason);
    if (reason === 'unauthenticated') {
      const answer = await api.window.showErrorMessage(
        `Sign in to add ${named} from the Lace registry.`,
        SIGN_IN_ACTION,
      );
      if (answer === SIGN_IN_ACTION) await api.commands.executeCommand(SIGN_IN);
      return;
    }
    const why =
      (error.apiCode === undefined
        ? byReason(PLACEMENT_REFUSALS, reason)
        : PLACEMENT_API_REFUSALS[error.apiCode]) ?? 'the engine refused it';
    const answer = await api.window.showErrorMessage(
      `Lace could not add ${named} to ${label}: ${why}.`,
      SHOW_DETAILS,
    );
    if (answer !== SHOW_DETAILS) return;
    log.appendLine(`Adding ${named} to ${label}: ${error.message}`);
    log.show(true);
  }

  // What a deprecated placement adds: the newest published version, from the caller's latest or one
  // `registry get`. A failed read is logged once, and the message says so.
  async function suggestion(module: PlacedModule, known: Latest | undefined): Promise<string> {
    let latest = known;
    if (!latest) {
      const key = moduleKey(module);
      const read = await asRead(
        () => reads.get(key),
        (error) => log.appendLine(`Reading the latest version of ${key}: ${failureText(error)}`),
      );
      if (read.kind === 'failed') return ` — ${UNREAD_NEWEST}; see the Lace Output channel.`;
      latest = loaded(read)?.latest;
    }
    const note = newestPublishedNote(latest, module.version);
    return note ? ` — ${note}; place that one instead.` : '';
  }

  // The status message this function set last; advice never replaces a later one.
  let statusSet = 0;
  function say(named: string, label: string, advice = ''): number {
    api.window.setStatusBarMessage(`Lace: added ${named} to ${label}${advice}`, 5000);
    return ++statusSet;
  }

  // The stamp of the added message, or undefined when the module was not added;
  // the recents mark follows it, and the session is released before any advice.
  async function apply(
    editor: EditorPort,
    module: PlacedModule,
    named: string,
    label: string,
  ): Promise<number | undefined> {
    const action: Action = { place_module: module };
    const result = await api.window.withProgress(
      { location: api.ProgressLocation.Notification, title: `Lace: adding ${named} to ${label}` },
      () => editor.apply([action]),
    );
    if (!result.success) {
      void api.window.showErrorMessage(
        `Lace could not add ${named} to ${label}: ${result.errors.map((e) => e.message).join('; ')}`,
      );
      return undefined;
    }
    const stamp = say(named, label);
    await placed(module);
    return stamp;
  }

  return async (module, status, latest) => {
    const named = `${module.author}/${module.name} ${versionTitle(module.version, status)}`;
    const root = await rootToAct(sources, api.window, `add ${named} to`);
    if (!root) return;
    const label = rootLabel(root, sources.folders());
    try {
      await panels.ensure(root, { preserveFocus: true });
      const hold = await rootSessions.acquire(rootPath(root));
      let added: number | undefined;
      try {
        added = await apply(hold.ports.editor, module, named, label);
      } finally {
        await hold.release();
      }
      if (added !== undefined && isDeprecated(status)) {
        const advice = await suggestion(module, latest);
        if (advice && added === statusSet) say(named, label, advice);
      }
    } catch (error) {
      if (error instanceof ConnectError) return refused(named, label, error);
      void api.window.showErrorMessage(
        `Lace could not add ${named} to ${label}: ${failureText(error)}`,
      );
    }
  };
}
