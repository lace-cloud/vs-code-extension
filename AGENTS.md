# AGENTS.md: the Lace VS Code extension

For coding assistants and developers working on this repository. `CLAUDE.md` is the quick start (words, layout, the
libraries and the engine, build and test, branch flow); this file is the architecture and the rules each module
follows. Every source file opens with a comment saying what it owns: that comment is the authority for its file, and
this file is the map between them.

## What the extension is

The full VS Code host of Lace's module-authoring canvas. The canvas UI element is the canvas package's: the graph, its
inspectors, settings, Save, Generate, Validate, Convert, undo, groups, diagnostics, the conflict and refused-Terraform
states, and the badges of the stack picked for the module. The packages carry what a host builds on: the engine mapping,
the typed command contract, the command bindings with their runner and the reducers (`@lace-cloud/canvas/engine`); the
tool contract and the tool sets (`@lace-cloud/chat-core`). The extension supplies every port and draws its own UI over
that data: the registry sidebar and module detail, the Stacks tree, the palette commands, the
Problems panel, sign-in with organization and team, the chat tools. It adds nothing no journey needs.

Three levels work on one module: the `.tf` files, the canvas, and the developer's coding assistant in VS Code's chat.
They share one authoring session per authoring root, so an edit through any level is what the others show next; git
shows what changed after Generate.

## Activation

`src/extension.ts` builds the window's base: the "Lace" Output channel, the engine, the root sessions, and the autosave
keeper observing every held session. `windowHost` (`src/features.ts`) builds the owners more than one feature reads (the
root state, the canvas panels, the commands mapping, the account, the window's one action runner with its runs' Output
channels and the offers its notices make, the root sources, Save and Generate's canvas operations, and the palette's
module commands with their Validate on a root) and hands the same `Host` to every feature in `FEATURES`:

| Feature | Registers |
|---|---|
| engine controls | Start, Stop, Restart Engine, Open Logs; the engine's status bar item |
| canvas | Open Canvas; the canvas panels' lifetime |
| problems | the Problems observer on every held session |
| module commands | Save, Generate, Validate, Convert, Format, Scan, Generate Docs |
| registry | the `laceRegistry` webview view, module detail, Refresh Registry, Add Module to Canvas |
| account | Sign In, Sign Out, Select Organization, Select Team; the selection's status bar item |
| stacks | the `laceStacks` tree and its commands; the runner's and the run channels' lifetime |
| tools | the chat tools, where the Language Model Tools API exists |

`activate` returns `{engine, rootSessions}`. `deactivate` flushes every held session's autosave, then stops the engine,
which closes every session and frees every lock. `src/__tests__/manifest.test.ts` holds the manifest and the features to
each other: every contributed command, view and tool is one a feature registers, and nothing else is registered.

## Who owns what

| Decision or state | Owner | Read by |
|---|---|---|
| The engine process, its state, `lace.binaryPath` and `lace.autoRestart` | `engine/engine.ts` | everything |
| A root's session: holders, `SessionOpen`, `SessionClose`, and what observers attach to it | `engine/root-sessions.ts` | canvas panels, tools, Save, Generate, placement, Problems, autosave |
| A canvas tool call's tool set, over the ports of its hold's session | `tools/lm-tools.ts` | that call |
| A command's working directory | `engine/commands-mapping.ts` | every command the host runs |
| Running a package binding (Stacks rows, stack palette commands) | `engine/runner-host.ts` | the Stacks tree, the offers |
| A command's outcome: its document or its failure | `engine/command-outcome.ts` | every command's caller |
| Which authoring root a surface acts on, or why none (`Named`), and what the developer is told then | `roots/authoring-roots.ts` (`nameRoot`, `rootToAct`) | every surface that acts on a module |
| How a line typed into a terminal calls a program in the terminal's shell | `vscode/shell-line.ts` (`shellLine`, over `env.shell`) | Create Stack in Terminal |
| A root's canvas panel, and the long-lived hold | `canvas/canvas-panels.ts` (`ensure`) | Open Canvas, tools, placement, the Stacks tree |
| Save's rule and Generate's rule | `commands/canvas-operations.ts` | the palette, the tools |
| Whether this window holds a root's session, root compared with root | `commands/canvas-operations.ts` (`held`) | Save, where a module command's report lands |
| The picked stack and the canvas arrangement per root | `state/root-state.ts` (`workspaceState`) | the Stacks tree, the canvas page |
| Favourites and recently used modules | `registry/registry-marks.ts` (`globalState`) | the registry sidebar |
| When a canvas saves | `autosave/autosave-policy.ts`, from `files.autoSave` | the root sessions (flush before close) |
| What reaches Problems | the package's report fold, read by `diagnostics/problems.ts` | the Problems panel |
| Whether the developer is signed in, organization, team | the CLI (`whoami`, `org current`, `team current`) | the account, the views |
| The way out a failure names | `vscode/offers.ts`, by the failure's `reason` | every notice of a failed command |
| Validate on a root, whatever offers it | `commands/authoring-commands.ts` (`validate`, the palette's Validate) | the palette, the Stacks tree's apply, a notice about a root |

## Engine and sessions

**One engine per window.** `engine.ts` runs one `lace engine` through `@lace-cloud/host`'s `ServerManager`, started on
demand by the first caller. The engine is spawned with a stdin pipe the manager holds and exits when it closes, so an
extension host that dies takes its engine, sessions and locks with it. The handshake's protocol version decides
compatibility: an engine of another protocol is refused with a message that names which side to update. The extension
host reaches the engine through an in-process bridge of its own (`bridgeCaller` over `serveEngineBridge`), the same
typed mapping a webview holds over its bridge. `whenRunning` waits for a restart that `lace.autoRestart` or the developer
starts.

**One session per authoring root, `root-sessions.ts` its only owner.**

- The engine names the session: `acquire(root)` sends the root as VS Code spells it and keys the holder map on the
  session id the engine answers, so two spellings of one directory are one session. The host canonicalises nothing.
- Holders are counted. Only the last release sends `SessionClose`, through `open → closing → closed`: `closing` awaits
  every observer's `flush` (autosave), then re-checks the holders; an `acquire` that arrived meanwhile rejoins and no
  close is sent. `SessionOpen` and `SessionClose` are sent one at a time.
- A hold follows its root across the end of a session's stream: a `failed` end re-opens (`SessionOpen` joins a live
  session), a `closed` end opens a new session; holders hear it through `renewed`. The end comes from the session
  mapping's `source`, never from a host announcement.
- Observers (Problems, autosave) attach to every held session and never hold one. What an observer attached is disposed
  when the root leaves that session (the last release's close, a renewal, `dispose`) or the observation ends.
- **The canvas panel is the one long-lived holder.** It takes its hold when the panel is created, before the page boots.
- **An edit is never made by the last holder.** Every editing entry point that is not the canvas (the change tool, the
  registry's "+", module detail's Add to Canvas, Add Module to Canvas) first calls
  `canvasPanels.ensure(root, {preserveFocus: true})`, then holds the session for its own call.
- One rule per operation, whichever trigger runs it:
  - an edit: `ensure` first, then a hold for the call;
  - Generate and describe: a hold for the call, the root's open session or a new one, no tab;
  - Save: the root's open session only; a root with none holds no unsaved edit, and Save says so;
  - Validate, Convert, Format, Scan, Docs, the stack verbs, the registry reads: no session; they are commands.

**Every command names its working directory** (`commands-mapping.ts`): `at(root)` for a command that reads a module
directory, `anywhere()` (the developer's home) for one that reads none. No invocation carries a session id; the engine
runs a command on the root's session's Workspace when the root has one and on the directory otherwise, and creates no
canvas state. A command run through the engine takes exactly its terminal inputs. The canvas page and the chat's canvas
tool sets run theirs on the session mapping's own `commands` port, whose directory is the root.

**A command's outcome is its document** (`command-outcome.ts`): `{kind: 'result', document, exitCode}` or
`{kind: 'failure', failure}`. A command can render its result and exit non-zero (`module scan` with findings, `module
validate` when Terraform found errors), and that is a result.

**The runner host** is the window's one `createActionRunner` over the home port and one result store. The Stacks tree and
the stack palette commands run the package's bindings through it with a `RunCtx` naming the root and the stack; the
binding owns the arguments, the confirmation and the result folding, and the host draws the store. A binding that
declares the root runs in it. `onDidTick` tells each tick of the store with the `RunCtx` of the run whose binding ticked
it: the store's tick names no run, so the host runs each binding inside an async context (`AsyncLocalStorage`) carrying
its `RunCtx` and reads it when the store notifies.

## The canvas tab

- `canvas-panels.ts`: one webview panel per root, created only by `ensure(root, {preserveFocus?})`; two `ensure` calls in
  flight make one panel. The title is the root's path under its workspace folder (`rootTitle`: the folder's name first
  in a workspace of several folders), with ● while the session is unsaved.
- The page (`canvas-webview/`) shares one postMessage pair between the engine bridge and the host protocol. It boots with
  the host's `boot` call (the root, the kept arrangement, the picked stack), opens the root's session over the bridge,
  and mounts the canvas package's `App` with its ports: `source`, `editor`, `commands`, `context` from the engine
  mapping, `viewState` from what the host kept, and a `presenter` whose notices and confirmations are VS Code's dialogs
  (`vscode/dialogs.ts`: a modal question, or one input box that returns only the exact typed value). It passes the
  host's one contribution (`canvas-webview/contributions.ts`): **Open source**, a host action on each row of the canvas's
  Diagnostics list, which sends the host the row's file, line and column (`openSource`), and says so for a diagnostic
  that names no file. The host opens the root's file at that place in the editor beside the canvas, and a file it cannot
  open fails the call with the reason.
- A notice from the page is the shared notice of `vscode/offers.ts`: a failure the canvas's own commands hit (its toolbar's
  Convert stopped at Terraform it cannot represent) offers the ways out its reason names, and Validate validates the
  panel's root with the palette's Validate.
- The page's `editor` is the mapping's, its Generate telling the host the files a Generate that succeeded wrote
  (`generated`); the host shows the notice Lace: Generate ends with, **Show Changes** opening Source Control.
- A pick of the root's stack reaches the page as an event and replaces only `context.stack`, so the canvas keeps its
  runner; a `tick` (a run the host started settled) re-reads what the canvas reads through its result store (the
  badges).
- When the hold's session is opened again after an end, the panel serves a new bridge and assigns new HTML; every
  document carries a fresh nonce (`vscode/webview-html.ts`), so the page reloads and boots again through its one path.
- The panel takes its webview once, when it is created: the engine can still answer a page after its tab closed, and
  that answer, posted to the closed webview, goes nowhere.
- A directory with no top-level `.tf` opens source-refused; the page shows the engine's message and the host offers
  **Create main.tf**, which opens an untitled `main.tf` there. The extension writes no source file: Generate, Format and
  Convert are the CLI's writers.
- The page reports its focus, which `onFocusChange` autosave reads. The canvas package's keymap handles its own keys;
  the extension contributes no keybinding.
- The page follows VS Code's theme (`webview/theme.ts`): `data-theme` on `<html>`, which the canvas's design tokens
  read, is `light` while `<body>` carries `vscode-light` or `vscode-high-contrast-light` and `dark` otherwise, and a
  theme switch, a change of that class, sets it again. The registry pages are drawn from VS Code's own `--vscode-*`
  variables and read no `data-theme`.

## Protocols

`src/protocol/` holds the two webview ↔ host protocols; both bundles import them, so the wire cannot drift. A frame from
the other side is untrusted and parsed out of `unknown` before a field is read.

- **The envelope**: every canvas-panel message is `{ch: 'engine', frame}` or `{ch: 'host', frame}`; `splitChannel` gives
  each protocol a port of its own over the one pair. The engine frames are `@lace-cloud/proto`'s bridge frames.
- **The host protocol** (`host-protocol.ts`): calls from the page `boot`, `confirm` and `openSource`; notices from the page
  `arrangement`, `notify` (with the failure document of the command it is about, when there is one), `unsaved`, `focus`,
  `generated` (the files the canvas's own Generate wrote); events from the host `stack` and `tick`.
- **The registry protocol** (`registry-protocol.ts`): the host sends the page its whole state (`{op: 'state', state}`);
  the page says what the developer did. The registry pages reach no engine.

## Registry sidebar and module detail

- `registry-reads.ts`: `registry list --axis module --limit 500`, `registry get`, `registry describe`, `org current`, each
  in the home. The sidebar reads once, unfiltered, and the page filters as the developer searches and picks categories; a
  row's versions are read on expand. The view reads again when it becomes visible and after each account change.
- The sidebar's states come from a failed list's `reason`: `unauthenticated` → Sign In, `no_organization` → Select
  Organization, anything else its message with Retry. An empty registry shows "No modules are published yet" with the
  publishing guide link the list itself carries.
- Module detail (`module-detail.ts`, one panel per module): `registry get` for the README and versions, `registry
  describe` of the shown version for the interface (it downloads and certifies the version, so it settles later and can
  be refused). Tabs: Details, Interface, Versions, Examples.
- Placement (`place-module.ts`): `nameRoot`, `ensure` without focus, a hold for the call, one `place_module`. A refusal is
  read by its reason: `unauthenticated` offers Sign In; `not_lace_form`, `hash_mismatch`, `registry_unavailable`,
  `not_found`, `version_not_found`, `forbidden` are named with the module (any other reason as "the engine refused
  it"), and **Show Details** writes the engine's full message to the "Lace" Output channel.
- Favourites and recently used (five) are keyed on `author/name`, so a new version keeps its star.

## Stacks tree

- `laceStacks` lists the current root's stacks (`stack list --source <root>`), each with its ten latest runs
  (`run list --stack`). The root follows the active canvas and the active `.tf` editor; **Show Stacks of a Module** picks
  it. The view's description names it.
- Row actions are the canvas package's bindings run through the runner: `preview`, `apply`, `scan` on a stack,
  `follow-logs`, `run-cancel` on a run; Open in Portal opens the URL the CLI gave the run. The tree opens no session:
  the stack commands run the Terraform on disk. From the palette, Preview, Apply and Scan Stack pick a stack of the named
  root.
- Selecting a stack picks it for its root (`root-state.ts`), and the root's canvas draws its badges. Each tick of the
  runner's store (a run started or settled, a scan or a cancel done) re-reads the tree and ticks the canvas of the root
  that run was about, its `RunCtx.root`, whatever the tree ran since.
- An apply runs under a cancellable progress notification; every `log` line, the Preview Advisory included, goes to the
  stack's Output channel `Lace: <slug>` (`run-output.ts`), which Follow Logs writes to as well. Its notice offers the
  ways out its failure names; `no_certification` and `stale_certification` offer **Validate**, the palette's Validate
  on the root that apply ran in, whose report lands where the palette's does. A preview opens as a read-only
  `lace-preview:` document.
- When the stacks cannot be listed, the context key `lace.stacks.state` selects the welcome view by the failure's reason:
  `signedOut`, `noOrganization`, `noTeam`, `teamlessOrganization` (Open Portal opens the URL the failure carries; the
  host builds no portal URL), `noStack`, `noRoot`, `failed`. The tree does not offer `lace stack destroy`; it is a
  terminal command.
- Creating a stack is one-time setup in a terminal, not a journey of the extension. `noStack`'s action, Create Stack in
  Terminal (`lace.stacks.createInTerminal`), types `<lace.binaryPath> stack create SLUG --source . --connection
  CONNECTION_ID` into a terminal at the root, unsent: a placeholder for each argument `stack create` requires
  (`stacks-tree.test.ts` reads them from the command contract), which the developer fills in before running it. The
  terminal runs the default profile, whose shell `env.shell` names, and the line calls the CLI as that shell calls a
  program by its path (`vscode/shell-line.ts`): PowerShell `& 'path'` (each of `' ‘ ’ ‚ ‛` doubled), Command Prompt
  `"path"`, fish `'path'` (`\` and `'` escaped), nushell `^'path'` (a raw string when the path holds `'`), any other
  shell POSIX single quotes. VS Code's API puts no command on a prompt unsent in the shell's syntax
  (`shellIntegration.executeCommand` runs it), so that rule is the extension's, in that one module. With WSL as the
  default profile, `env.shell` is `wsl.exe`, which names neither the distribution's shell nor how it mounts the Windows
  path the setting names, so the line is written for a POSIX shell and may not run there.
- A stack palette command (Preview, Apply, Scan Stack) on a root with no stack says so, and that Create Stack in
  Terminal creates one; it shows no empty pick.

## Module commands

`commands/authoring-commands.ts`; every command acts on the root `nameRoot` names and says which. When none is named,
`rootToAct` says why by the reason `nameRoot` gives (no folder is open; no directory holds Terraform; several do and the
sources have no pick to ask; the folder pointed at is outside the workspace, or is or is inside `.terraform` or `.lace`,
which is not a module directory), and a pick the developer dismissed says nothing. Open Canvas, placement, the stack palette commands (Preview,
Apply, Scan Stack, Show Stacks of a Module) name their root the same way; the Stacks view names its root quietly, from
sources with no pick, and a root it cannot name is its `noRoot` state.

- **Save** and **Generate** run `canvas-operations.ts`, the same functions the chat tools run. Generate first saves the
  root's dirty `.tf` editors, holds the session for the call with no tab, shows its progress, and ends with the files
  written (`generated`: **Show Changes** opens Source Control, the notice the canvas's own Generate ends with too; a
  Generate that wrote no file says that nothing was written and offers nothing) or the engine's refusal (an unsaved
  canvas offers **Save**).
- **Validate**, **Format**, **Scan** and **Generate Docs** run `module validate`, `module fmt`, `module scan`, `module
  docs` through `commands.at(root)`, with no session. **Convert Module** (`lace.convertModule`) runs `module convert` the
  same way and reports as Validate does, with no confirmation (the canvas action has none); an open canvas picks the
  rewritten Terraform up live. Format and Convert write the root's Terraform, so they first save its dirty `.tf` editors,
  as Generate does; Validate, Scan and Generate Docs read the files as they are on disk, as in a terminal. One operation
  behaves the same by every trigger: the chat's validate tool and the canvas's Validate read the disk too, and a read
  writes nothing into the tree (a save before it would, and with saved but ungenerated canvas edits it would raise the
  conflict unasked).
- A report reaches Problems when this window holds the root's session (`operations.held`, which reads each held session's
  path back as the root it names and compares roots; the engine publishes the result to the session);
  otherwise it is the command's result: a notification with the verdict, when the run reached one (a tree Lace's rules or
  the parse refuse has none, and its diagnostics are its outcome), and **Show Report** writes each diagnostic with its
  file and line to the "Lace" Output channel.
- A failure is the shared notice of `vscode/offers.ts`, with the ways out its reason names: `tool_missing` names the
  tool with **Install** on the URL the failure carries; `source_refused` (a Convert stopped at Terraform it cannot
  represent as written) offers **Validate** of the same root, whose report names what is refused; `not_git_repository`
  offers nothing, its message says to run `git init`. Validate is offered only by a notice that names its root: a notice
  the window's runner presents carries no run, so it offers none. Validate and Convert run through the commands mapping,
  not the runner: the package's bindings for them hand the presenter a verdict line and no document. Generate Docs opens the markdown in an untitled editor and writes
  nothing into the tree (a README beside the `.tf` would move the tree's hash).

## Problems

`diagnostics/problems.ts` observes every held session and keeps one `DiagnosticCollection` per root. It only maps: which
report is current, which diagnostics are duplicates and what a document means are the package's (`foldReport`,
`currentReport`, `reportDiagnostics`, `diagnosticsOf`), the same fold the canvas runs, so a report the canvas drops leaves
Problems with it. A result the session published before the observer subscribed is replayed to it. A diagnostic's file
is root-relative and joined to the workspace folder's own URI; no line is line 1, and a diagnostic that names no file
(located in the graph, or a command's failure) is skipped: it stays on the canvas.
Entries clear when the session ends.

## Autosave

`autosave/autosave-policy.ts` maps `files.autoSave`, read per workspace folder, onto the package's `autosave` primitive,
attached once per held session: `off` attaches nothing; `afterDelay` saves `files.autoSaveDelay` after the latest edit;
`onFocusChange` flushes on the page's blur, the window's blur, and an edit applied while the page has no focus;
`onWindowChange` flushes on the window's blur. Under every mode but `off`, the last release and `deactivate` flush
before the session closes. A change to the setting re-arms every attachment. There is no `lace.autoSave` setting.

## Account

`account/`: Sign In runs `lace login` (the confirmation code shown once with Copy Code, the page opened once, under a
cancellable progress notification); Sign Out runs `lace logout`. Organization and team are the CLI's: `org list`,
`org use`, `team list`, `team use`, `org current`, `team current`, all in the home. Selecting an organization goes on to
its team, listed and saved with `--org` naming the organization just picked, so the saved team is that organization's
even while `LACE_ORGANIZATION` sets another; an organization with no team says teams are created in the portal, with Open
Portal on the page `team list` names (`createUrl`). The status bar item shows the selection and runs Select
Organization; it is read again after each change and when the window regains focus. Nothing is cached.
A failed account command offers the way out its reason names (`vscode/offers.ts`).

## The chat tools

The extension contributes tools to VS Code's own chat and nothing else: no chat view, no participant, no MCP server, no
model of Lace's. The tools run in the developer's own model, and the conversation itself is never sent. A tool reaches
the network only as the CLI command it runs does in a terminal:

- search: the query, system and category to Lace's registry (`registry list`);
- registry describe: the module and version, and it downloads that version's tree from Lace's registry (`registry
  describe`);
- a place change: the module's name to Lace's registry (`registry list --query`), and the engine fetches the module it
  adds;
- validate, and generate after it writes (it validates the tree it wrote), run Terraform as `lace module validate`
  does: the CLI reaches `releases.hashicorp.com` on every run and downloads the Terraform it pins from there on first
  use, and that Terraform calls `checkpoint-api.hashicorp.com` when its update check is stale; `terraform init
  -backend=false` takes the module's providers from Lace's provider mirror, or from the public Terraform registry under
  a break-glass grant (signed in, validate asks Lace for the active provider-mirror grant), and its `lace.cloud/`
  modules from Lace's registry.

Describe, save and every change but a place work on the root's files and the engine alone. The tool sets are
chat-core's (`canvasTools({source, editor, commands})` and `moduleTools({commands})`), each tool a schema and a handler
on chat-core's one tool contract.

| Tool | Reference | Runs |
|---|---|---|
| `lace_change_module_canvas` | `#laceChangeModuleCanvas` | `ensure` without focus, then a hold for the call; each change one `ApplyAction` |
| `lace_describe_module_canvas` | `#laceDescribeModuleCanvas` | a hold for the call, no tab |
| `lace_save_module_canvas` | `#laceSaveModuleCanvas` | Save's rule: the open session only |
| `lace_generate_module_terraform` | `#laceGenerateModuleTerraform` | Generate's rule: dirty `.tf` editors saved, a hold for the call, no tab |
| `lace_validate_module_terraform` | `#laceValidateModuleTerraform` | `module validate` in the root, no session |
| `lace_search_module_registry` | `#laceSearchModuleRegistry` | `registry list --axis module` in the home, no session |
| `lace_describe_registry_module` | `#laceDescribeRegistryModule` | `registry describe` in the home, no session |

**The adapter** (`tools/lm-tools.ts`) adds what only VS Code knows:

- the `root` input every tool requires: the module directory's path in the workspace (`.` for a folder itself, the
  folder's name first in a multi-root workspace) or its absolute path, resolved to one of the directories holding
  Terraform; any other is an error listing them;
- the reference name, the tool's name in camel case;
- the manifest's `languageModelTools` entries, generated from the tool sets' schemas (`canvasToolSchemas`,
  `moduleToolSchemas`, chat-core's data, read with no ports): `pnpm manifest:tools` writes them, and
  `__tests__/lm-tools.manifest.test.ts` fails on any hand edit. No entry has a `when` clause.

Registration is feature-detected: where `vscode.lm.registerTool` is absent (Cursor and other forks) the extension
activates without its tools. No tool returns `confirmationMessages`; the chat shows the row with its invocation message.
A result chat-core marks as an error is thrown, which is how a Language Model Tool fails.

**A canvas tool set per call.** chat-core's `canvasTools` keeps nothing between calls: a tool reads the session's frames
only while its call runs. Every canvas tool call (change, describe, save, generate) takes its hold by its operation's
rule and runs on a set made for that call over the ports of the session the hold is on (`source`, `editor`,
`commands`), so the tools keep nothing per session and observe no session. A call under way when its root's session is
opened again finishes on the ports it began on; the next call is on the new session. Where the Language Model Tools API
is absent no tool is registered.

**How a change resolves** (chat-core): the change tool takes `{changes: [{operation, instance?, input?,
sourceInstance?, output?, targetInstance?, module?, value?}]}`, one entry per change, each naming what it works on as
the canvas lists it and the literal the developer gave in `value`. A name resolves exactly, then ignoring case; a name
that matches nothing or several things, or a slot the operation needs and the change does not state, leaves that
change unapplied, and the result lists the candidates. A place resolves `module` among what `registry list --query`
lists; a module that listing does not hold lists no candidates, and the result points to `lace_search_module_registry`.
A connect that names no pin is the canvas's `auto_connect`, and the pairs the engine's matcher leaves tied come back to
choose between. The changes apply in order, each as one `ApplyAction`. Every result ends with the current canvas;
sensitive values are withheld.

**Cancellation.** `invoke` resolves the call's `root` first, which reads the workspace's files and nothing else. A
call whose token is cancelled by then, whether before it was invoked or while its root was resolved, throws VS Code's
`CancellationError`, for every tool and whatever the resolution found (an unknown `root` included): no panel opened, no
session held, no handler called. Otherwise `invoke` maps the
`CancellationToken` to an `AbortSignal` (aborted on `onCancellationRequested`, the listener disposed when the call
settles) and hands it to chat-core's handler: a change cancelled during the call starts nothing further and applies
nothing after the cancellation, and the module tools stop waiting on their command.

**The text level.** `resources/instructions/lace-modules.instructions.md`, contributed through `chatInstructions` and
applied to `**/*.tf`, tells the developer's coding assistant the rules of editing a Lace module's `.tf` files directly.
It names no tool, so it is true wherever the tools are absent (`src/__tests__/instructions.test.ts`).

## Tests

| Project | Files | Needs |
|---|---|---|
| `unit` | `src/**/*.test.ts(x)` | the installed dependencies |
| `build` | `src/**/*.build.test.ts` | the bundles in `out/` (`pnpm build`) |
| `engine` | `src/**/*.engine.test.ts` | the `lace` CLI that `LACE_CLI_VERSION` names, in `bin/` or on `PATH` |

- **Fakes for unit tests**: `engine/__tests__/fake-commands.ts` (one commands mapping and home port whose commands a test
  scripts per path, recording each invocation's directory), `engine/__tests__/fake-engine.ts` (an engine at the bridge,
  so the real caller, mapping and codecs run), `tools/__tests__/fake-session.ts` (a session over a small Bundle, root
  sessions with the real rule for holders, VS Code's cancellation of a tool call), `roots/__tests__/fake-uri.ts`,
  `diagnostics/__tests__/fake-problems-api.ts`.
- **The real engine**: `engine/__tests__/real-engine.ts` is the one helper every engine test builds on: a git repository
  with module directories, a signed-out developer home of the test's own, an engine with its root sessions and commands
  mapping as one window has them, and cleanups run after each test, latest first. The engine is `bin/lace` when one is
  there, else the `lace` on `PATH` (`engine/__tests__/engine-binary.mjs`, which the window e2e reads too), and it is the
  release `LACE_CLI_VERSION` names: a binary whose `lace version -o json` says another version, any other build of the
  CLI included, is refused before a test runs.
- **The chat tools end to end**: `tools/__tests__/lm-tools.engine.test.ts` invokes every tool `registerLaceTools`
  registers with a `root`, over the real engine, the window's canvas panels (with a stand-in webview panel) and
  commands mapping, signed out; a delete makes no request of the extension's own beyond the engine.
- **The window e2e** (`packages/host-e2e/window/`, `pnpm --filter @lace-cloud/host-e2e test` after `pnpm build`): Mocha
  suites, bundled by the package's rspack config, that `@vscode/test-cli` runs in a real VS Code against the engine the
  engine tests run (or the binary `LACE_E2E_ENGINE` names, held to the same version). Each run opens a fresh git
  repository whose settings name the engine, with a Lace config directory of its own, so every case is signed out:
  activation (every manifest command registered, an engine of the extension's protocol), the palette's module commands
  (Validate, Generate with no tab, Convert in place), the canvas tab over one session per root (another client's edit,
  a hand edit, the lock, `files.autoSave`, the engine's restart), and an engine that cannot start. CI runs it under
  `xvfb-run`.
- **Nothing in the tests signs in.** What needs a developer who is signed in (the registry, the Stacks tree, the
  organization and team) is unit-tested over scripted commands.
- **Repository tests** in `src/__tests__/`: the manifest against the features, the tracked pins (published versions
  only, and a lockfile that locks exactly what the manifests name), the configuration
  (every tsconfig include holds tracked files, every workflow runs on `develop` or `main`), the host bundle's
  imports (only `vscode`, `node:*`, `@lace-cloud/host`, `@lace-cloud/canvas/engine`, `@lace-cloud/proto`,
  `@lace-cloud/chat-core`), the bundles (one React per page, no canvas or engine in the registry pages, the host bundle
  loading in Node with `vscode` stubbed), the text-level instructions, and the README naming every command, setting and
  tool.

## Gotchas

- **The host bundle is Node.** Code reachable from `src/extension.ts` imports `@lace-cloud/canvas/engine`, never the
  `@lace-cloud/canvas` barrel, React or a stylesheet; webview code imports no `vscode`. The two tsconfigs split along
  that line.
- **A new command** is a manifest entry, a feature's registration (the parity test) and a README row (the README test).
  **A new tool** is chat-core's, then `pnpm manifest:tools`.
- **A failure is read by its `reason`**, from the failure document the CLI ends with; never match its message.

## Style

- TypeScript strict. No `any`; a cast names why in a comment.
- Small modules with one owner each, composed in `features.ts`; a function from the ports it needs to what it does.
- Every source file opens with a comment saying what it owns, and the comment stays true.
- Test names state behaviour. A test fake models the real thing's rule, not the code under test.
- No dead code: every export has a consumer.
