// The Lace tools in VS Code's chat: chat-core's tool sets adapted to
// Language Model Tools. chat-core says what each tool is (its name, title,
// description and input schema) and what it does; this adapter adds what
// only VS Code knows:
//
//   - the `root` input every tool takes, the module directory the call is
//     for, resolved to an authoring root of the workspace and from it to the
//     session or the commands port the tool runs on;
//   - the reference name the developer types after `#` and the model of an
//     agent host is shown, the tool's name said in camel case;
//   - the manifest's `languageModelTools` entries, generated from the tool
//     sets' schemas (`canvasToolSchemas`, `moduleToolSchemas`), which
//     `__tests__/lm-tools.manifest.test.ts` holds the manifest to.
//
// The tools run in the developer's own model and reach the engine and the
// CLI; through the CLI, the registry tools and a place reach Lace's registry
// with their search words or the module's name. A canvas tool call runs on
// chat-core's `canvasTools`, made for that call over the ports of the
// session its hold is on: the set keeps nothing between calls, so nothing is
// kept here per session either.
//
// How a call reaches what its tool works on, one rule per operation:
//
//   change             the root's canvas panel first, without taking focus,
//                      so the edit lands where the developer sees it and a
//                      visible holder outlives the call; then a hold of its
//                      own for the call.
//   describe           a hold for the call: the root's open session, or a new
//                      one, and no tab.
//   save, generate     the canvas operations' one rule each, which the
//                      palette's Lace: Save and Lace: Generate run too: save
//                      on the root's open session only, and a root with none
//                      says it holds no unsaved edit; generate after the
//                      root's Terraform buffers are saved, on a hold for the
//                      call with no tab.
//   validate           `module validate` in the root's directory, no session.
//   the registry tools their command in the developer's home, no session.
//
// Nothing asks: no tool returns `confirmationMessages`, and the chat shows
// the tool's row with its invocation message. A result chat-core marks as an
// error is thrown, which is how a Language Model Tool says its call failed.
// A call whose token is already cancelled when it is invoked throws VS
// Code's `CancellationError` before anything runs: no root is resolved, no
// panel opened, no session held, no handler called. A cancellation that
// arrives during the call reaches chat-core's handler as an `AbortSignal`:
// a cancelled change applies nothing further.
import { posix } from 'node:path';
import {
  type CanvasTools,
  canvasToolSchemas,
  canvasTools,
  moduleToolSchemas,
  moduleTools,
  type ToolResult,
  type ToolSchema,
} from '@lace-cloud/chat-core';
import type * as vscode from 'vscode';
import type { CanvasPanels } from '../canvas/canvas-panels';
import { type CanvasOperations, notDoneText, type Operated } from '../commands/canvas-operations';
import type { CommandsMapping } from '../engine/commands-mapping';
import type { RootHold, RootSessions } from '../engine/root-sessions';
import {
  type AuthoringRoot,
  type RootSources,
  rootPath,
  rootsHolding,
  workspacePath,
} from '../roots/authoring-roots';

type Input = Record<string, unknown>;

// One tool as the extension contributes it: chat-core's schema, and the
// call that resolves to what the tool works on and runs it there. `signal`
// is the developer's cancellation of the call, handed to chat-core's
// handler.
export type LaceTool = {
  readonly schema: ToolSchema;
  readonly call: (root: AuthoringRoot, input: Input, signal?: AbortSignal) => Promise<ToolResult>;
};

export type LaceToolPorts = {
  panels: Pick<CanvasPanels, 'ensure'>;
  rootSessions: Pick<RootSessions, 'acquire'>;
  operations: CanvasOperations;
  commands: CommandsMapping;
};

// The tool sets' schemas, as chat-core states them as data: what the
// manifest and the registrations read of each tool.
const [CHANGE, DESCRIBE, SAVE, GENERATE] = canvasToolSchemas;
const [VALIDATE, SEARCH_REGISTRY, DESCRIBE_REGISTRY_MODULE] = moduleToolSchemas;

// Every tool's schema, in the order the manifest lists them.
export const TOOL_SCHEMAS: readonly ToolSchema[] = [...canvasToolSchemas, ...moduleToolSchemas];

// The canvas tools over the ports of the session `hold` is on now.
const canvasOf = ({ ports }: RootHold): CanvasTools =>
  canvasTools({ source: ports.source, editor: ports.editor, commands: ports.commands });

export function createLaceTools(ports: LaceToolPorts): readonly LaceTool[] {
  const { panels, rootSessions, operations, commands } = ports;

  // A call on the root's session, held for the call's duration.
  async function held(
    root: AuthoringRoot,
    use: (tools: CanvasTools) => Promise<ToolResult>,
  ): Promise<ToolResult> {
    const hold = await rootSessions.acquire(rootPath(root));
    try {
      return await use(canvasOf(hold));
    } finally {
      await hold.release();
    }
  }

  // An operation's result: the tool's own, or what the operation that did
  // not run says, as an error when it was asked for and could not run.
  const resultOf = (root: AuthoringRoot, outcome: Operated<ToolResult>): ToolResult =>
    outcome.kind === 'done'
      ? outcome.value
      : { content: notDoneText(root, outcome), isError: outcome.kind === 'bufferNotSaved' };

  return [
    {
      schema: CHANGE,
      call: async (root, input, signal) => {
        await panels.ensure(root, { preserveFocus: true });
        return held(root, ([change]) => change.handler(input, signal));
      },
    },
    {
      schema: DESCRIBE,
      call: (root, input, signal) => held(root, ([, describe]) => describe.handler(input, signal)),
    },
    {
      schema: SAVE,
      call: async (root, input, signal) =>
        resultOf(
          root,
          await operations.save(root, (hold) => {
            const [, , save] = canvasOf(hold);
            return save.handler(input, signal);
          }),
        ),
    },
    {
      schema: GENERATE,
      call: async (root, input, signal) =>
        resultOf(
          root,
          await operations.generate(root, (hold) => {
            const [, , , generate] = canvasOf(hold);
            return generate.handler(input, signal);
          }),
        ),
    },
    {
      schema: VALIDATE,
      call: async (root, input, signal) => {
        const [validate] = moduleTools({ commands: await commands.at(rootPath(root)) });
        return validate.handler(input, signal);
      },
    },
    {
      schema: SEARCH_REGISTRY,
      call: async (_root, input, signal) => {
        const [, search] = moduleTools({ commands: await commands.anywhere() });
        return search.handler(input, signal);
      },
    },
    {
      schema: DESCRIBE_REGISTRY_MODULE,
      call: async (_root, input, signal) => {
        const [, , describe] = moduleTools({ commands: await commands.anywhere() });
        return describe.handler(input, signal);
      },
    },
  ];
}

// ── The `root` input ──

const ROOT_PROPERTY = {
  type: 'string',
  description:
    "The module's directory: its path in the workspace, such as `infra/prod`, or `.` for the workspace folder itself. In a workspace of several folders the folder's name comes first, such as `api/infra/prod`.",
};

// What a tool's `root` calls an authoring root: its path in the workspace,
// `.` for a workspace folder itself, with the folder's name first in a
// workspace of several folders.
export function rootName(root: AuthoringRoot, folders: readonly vscode.WorkspaceFolder[]): string {
  const path = workspacePath(root, folders);
  return path === '' ? '.' : path;
}

// A `root` that names no directory of the workspace holding Terraform.
export class UnknownRoot extends Error {
  constructor(
    readonly given: string,
    readonly roots: readonly string[],
  ) {
    super(
      `No module directory of this workspace is named ${JSON.stringify(given)}. The directories holding Terraform (${roots.length}): ${roots.join(', ')}.`,
    );
  }
}

// The authoring root a tool's `root` names: one of the directories holding
// Terraform, named as `rootName` names it or by its absolute path.
export async function rootNamed(
  sources: Pick<RootSources, 'folders' | 'terraformFiles'>,
  given: string,
): Promise<AuthoringRoot> {
  const folders = sources.folders();
  const roots = rootsHolding(folders, await sources.terraformFiles());
  const spelled = posix.normalize(given.replace(/\/+$/, ''));
  const root = roots.find(
    (each) => rootName(each, folders) === spelled || rootPath(each) === given,
  );
  if (root === undefined) {
    throw new UnknownRoot(
      given,
      roots.map((each) => rootName(each, folders)),
    );
  }
  return root;
}

// ── The manifest's entries ──

// The name a developer types after `#`, and the one an agent host shows its
// model: the tool's name in camel case, so it says what the tool is for as
// the name does.
export function referenceName(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, next: string) => next.toUpperCase());
}

// A tool's input schema with the `root` every call names.
export function inputSchemaOf(schema: ToolSchema): Record<string, unknown> {
  const { properties, required } = schema.inputSchema as {
    properties?: Record<string, unknown>;
    required?: readonly string[];
  };
  return {
    ...schema.inputSchema,
    properties: { root: ROOT_PROPERTY, ...properties },
    required: ['root', ...(required ?? [])],
  };
}

export type LanguageModelToolEntry = {
  name: string;
  displayName: string;
  toolReferenceName: string;
  canBeReferencedInPrompt: boolean;
  modelDescription: string;
  inputSchema: Record<string, unknown>;
};

// The manifest's `languageModelTools` entries for the tools.
export function manifestEntries(schemas: readonly ToolSchema[]): LanguageModelToolEntry[] {
  return schemas.map((schema) => ({
    name: schema.name,
    displayName: schema.title,
    toolReferenceName: referenceName(schema.name),
    canBeReferencedInPrompt: true,
    modelDescription: schema.description,
    inputSchema: inputSchemaOf(schema),
  }));
}

// ── Registration ──

export type LanguageModelApi = {
  lm?: Partial<Pick<typeof vscode.lm, 'registerTool'>>;
  LanguageModelToolResult: typeof vscode.LanguageModelToolResult;
  LanguageModelTextPart: typeof vscode.LanguageModelTextPart;
  CancellationError: typeof vscode.CancellationError;
};

function rootOf(input: Input): string {
  const { root } = input;
  if (typeof root !== 'string') throw new Error("`root` is the module's directory");
  return root;
}

// What the tool is given beside `root`.
const toolInput = (input: Input): Input =>
  Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'root'));

// An `AbortSignal` that aborts when VS Code asks to cancel the call, until
// the returned `dispose` stops listening. The call's token is not cancelled
// yet: `invoke` has thrown for one that is.
function abortOn(token: vscode.CancellationToken): { signal: AbortSignal; dispose: () => void } {
  const cancelled = new AbortController();
  const listening = token.onCancellationRequested(() => cancelled.abort());
  return { signal: cancelled.signal, dispose: () => listening.dispose() };
}

function languageModelTool(
  api: LanguageModelApi,
  tool: LaceTool,
  sources: Pick<RootSources, 'folders' | 'terraformFiles'>,
): vscode.LanguageModelTool<Input> {
  return {
    prepareInvocation: ({ input }) => ({
      invocationMessage: `${tool.schema.title}: ${String(input.root)}`,
    }),
    invoke: async ({ input }, token) => {
      if (token.isCancellationRequested) throw new api.CancellationError();
      const cancellation = abortOn(token);
      try {
        const root = await rootNamed(sources, rootOf(input));
        const result = await tool.call(root, toolInput(input), cancellation.signal);
        if (result.isError) throw new Error(result.content);
        return new api.LanguageModelToolResult([new api.LanguageModelTextPart(result.content)]);
      } finally {
        cancellation.dispose();
      }
    },
  };
}

// Makes the tools and registers every one with VS Code's chat, until the
// returned disposable drops them. A host without the Language Model Tools
// API (Cursor and the other forks) runs the extension without its tools;
// their developers' assistants work at the text level.
export function registerLaceTools(
  api: LanguageModelApi,
  ports: LaceToolPorts,
  sources: Pick<RootSources, 'folders' | 'terraformFiles'>,
): vscode.Disposable {
  const register = api.lm?.registerTool?.bind(api.lm);
  if (register === undefined) return { dispose: () => {} };
  const registrations = createLaceTools(ports).map((tool) =>
    register(tool.schema.name, languageModelTool(api, tool, sources)),
  );
  return {
    dispose() {
      for (const registration of registrations) registration.dispose();
    },
  };
}
