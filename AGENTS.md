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
root state, the canvas panels, the commands mapping, the account, the window's one action runner with the prompts that
answer its forms, its runs' Output channels and the offers its notices make, the root sources over the canvas panels'
roots, Save and Generate's canvas operations, the palette's module commands with their Validate on a root, the one stack
pick, and Import Existing Resources on a root) and hands the same `Host` to every feature in `FEATURES`:

| Feature | Registers |
|---|---|
| engine controls | Start, Stop, Restart Engine, Open Logs; the engine's status bar item |
| canvas | Open Canvas; the canvas panels' lifetime |
| problems | the Problems observer on every held session |
| module commands | Save, Generate, Validate, Convert, Format, Scan, Generate Docs |
| registry | the `laceRegistry` webview view, module detail, Refresh Registry, Add Module to Canvas |
| account | Sign In, Sign Out, Select Organization, Select Team; the selection's status bar item |
| stacks | the `laceStacks` tree and its commands, Import Existing Resources; the runner's and the run channels' lifetime |
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
| Running a package binding (Stacks rows, stack palette commands, Create Stack, Import Existing Resources, a failure's package answer); a run's form, what its context was answered, and its end | `engine/runner-host.ts` | the Stacks tree, Import Existing Resources, the offers |
| How a run's form is answered: one VS Code prompt per argument name | `vscode/form-answerer.ts` (`formAnswerer`) | the window's runner |
| A quick pick whose items come from a read: on screen at once, busy, and filled when the read settles; a read that finds none closes it and runs the caller's own empty path, and one that fails closes it and rejects for the caller's notice | `vscode/pick.ts` (`pickFrom`) | the organization and team picks, the stack pick, the connection prompt, Add Module to Canvas |
| A run a trigger starts, under a progress notification until it ends; the title of a run's progress and prompts | `vscode/run-progress.ts` (`runUnderProgress`, `runTitle`) | Create Stack, Import Existing Resources, a failure's package answer, the answerer |
| A CLI command's effect, as the CLI declares it: a `read` changes nothing, a `write` may change something before its stream ends, a `rewrite` writes the module's own Terraform files | the package's `COMMANDS` (`COMMANDS[path].effect`) | what a stream that ended under a command says (`failureSays`); the module commands, which save the root's dirty `.tf` editors before a rewrite |
| A command's outcome: its document or its failure, and every failure of it as a `CommandFailedError`: its `message`, the package's reading of the failure, and its `failure` document when it wrote one | `engine/command-outcome.ts` (`commandOutcome`) | every command's caller |
| What a failed command says: its failure document's message when it wrote one, the CLI's stderr when it wrote none, its exit code when it wrote nothing at all, and for a stream that ended under it, by the command's effect, that a read is to be run again or that a write or a rewrite ran and may have made changes | the package's `failureSays`, which `commandOutcome` reads into its `CommandFailedError`, and sign-in for `lace login`'s own stream; `failureText` says a failure | every notice of a failed command, the Stacks view's message and rows |
| What is under way | the package's result store, the runner host's `store`, asked through the package's `commandUnderWay` | the Stacks view's progress (`stacks/stacks-tree.ts`) |
| Which authoring root a surface acts on, or why none (`Named`), and what the developer is told then; what the module commands, the canvas tab, the Stacks view and the tools' results call a root (`rootLabel`; a root whose folder has left the workspace is called by its directory's full path). A tool's `root` input has its own grammar (`rootName`), which keeps `.` for the folder of a workspace of one folder: a tool call's invocation message echoes the `root` the model gave, and the unknown-root error lists its candidates in that grammar, `.` among them, since the model passes them back as `root` | `roots/authoring-roots.ts` (`nameRoot`, `findRoot`, `rootToAct`, `rootLabel`) | every surface that acts on a module |
| A root's canvas panel, and the long-lived hold | `canvas/canvas-panels.ts` (`ensure`) | Open Canvas, tools, placement, the Stacks tree |
| Save's rule and Generate's rule | `commands/canvas-operations.ts` | the palette, the tools |
| Whether this window holds a root's session, root compared with root | `commands/canvas-operations.ts` (`held`) | Save, where a module command's report lands |
| The picked stack and the canvas arrangement per root | `state/root-state.ts` (`workspaceState`) | the Stacks tree, the canvas page |
| Favourites and recently used modules | `registry/registry-marks.ts` (`globalState`) | the registry sidebar |
| When a canvas saves | `autosave/autosave-policy.ts`, from `files.autoSave` | the root sessions (flush before close) |
| What reaches Problems | the package's report fold, read by `diagnostics/problems.ts` | the Problems panel |
| Whether the developer is signed in, organization, team | the CLI (`whoami`, `org current`, `team current`) | the account, the views |
| When the account changed: a change this window makes, or a read that differs from the last one | `account/account.ts` (`createAccount`, `onDidChange`) | the status bar, the registry view, the Stacks tree |
| The way out a failure names | `vscode/offers.ts`, by the failure's `reason`; the package actions that answer it, by their `answers` (`engine/runner-host.ts`) | every notice of a failed command |
| What a settled apply says and offers | `stacks/stack-rows.ts` (`outcomeNotice`) | the Stacks tree's apply |
| Which stack of a root a stack command no row names acts on | `stacks/stack-pick.ts` (`pickStack`) | the palette's Preview, Apply and Scan; Import Existing Resources |
| Import Existing Resources on a root | `stacks/import-resources.ts` (`resourceImporter`) | the canvas's source-refused banner, the palette |
| Validate on a root, whatever offers it | `commands/authoring-commands.ts` (`validate`, the palette's Validate) | the palette, the Stacks tree's apply, a notice about a root |

## Engine and sessions

**One engine per window.** `engine.ts` runs one `lace engine` through `@lace-cloud/host`'s `ServerManager`, started on
demand by the first caller. The binary is the `lace` on `PATH`, where the CLI's own install puts it, unless
`lace.binaryPath` names another executable; the manager spawns the value as given, so on Windows the setting names a
`lace.exe` (Node runs no `.cmd` or `.bat` without a shell). VS Code answers an unset setting with the manifest's
default, never the code's fallback, so the two are one value (`src/__tests__/manifest.test.ts`). The engine is spawned
with a stdin pipe the manager holds and exits when it closes, so an extension host that dies takes its engine, sessions
and locks with it. The extension speaks engine protocol 6 (`@lace-cloud/proto`'s `ENGINE_PROTOCOL_VERSION`), the
protocol of the CLI release `LACE_CLI_VERSION` names, and the handshake's protocol version decides compatibility: an
engine of another protocol is refused with a message that names which side to update. A start the spawn refused (the
`EngineSpawnError` `@lace-cloud/host` rejects with) says where the binary was read from, what happened, and, by its
`code`, how to get past it: a binary that is not found (`ENOENT`), to install the Lace CLI so `lace` is on `PATH` or to
set `lace.binaryPath` to its executable's full path; on Windows a `.cmd` or `.bat` (`EINVAL`), that Windows cannot
start one directly and to point `lace.binaryPath` at `lace.exe`. Any other failed start says where the binary was read
from and what happened. The extension host reaches the engine
through an in-process bridge of its own (`bridgeCaller` over `serveEngineBridge`), the same typed mapping a webview
holds over its bridge. `whenRunning` waits for a restart that `lace.autoRestart` or the developer starts.

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

**The runner host** is the window's one `createActionRunner` over the home port and one result store. The Stacks tree,
the stack palette commands, Create Stack and Import Existing Resources run the package's bindings through it with a
`RunCtx` naming the root and the stack; the binding owns the arguments, the confirmation and the result folding, and the
host draws the store. A binding that declares the root runs in it. What is under way is the store's to say, and the
Stacks view is the one place that asks it whether any command is, through the package's `commandUnderWay`; the host
keeps no count of its own.
The host runs each binding inside an async context (`AsyncLocalStorage`) carrying its run, which attributes to the run
what names none:

- `onDidTick` tells each tick of the store with the `RunCtx` of the run whose binding ticked it.
- The arguments a binding leaves to its host come as the runner's form (`onPendingFormChange`). What the run's `RunCtx`
  object was answered before is reused by argument name; the answerer (`vscode/form-answerer.ts`) asks the rest, one
  prompt per argument name: `slug` an input box that refuses an empty value, `connection` a pick from `lace connection
  list`, on screen while the list is read (a list that cannot be read, or an empty one, closes it, cancels the form and
  says why), `state` an open dialog for one file; any other name cancels the form with a notice. A dismissed prompt
  cancels the form. The host keeps the form the runner handed it last: a form superseded by a newer one submits and
  cancels nothing when its prompts settle. A submit runs in the run's context again.
- A run ends once nothing of it is pending: the runner's call, its form, its start after a submit (until the command
  starts, or the runner declines it: a confirmation answered no, or a refusal, which it states through `notify`), and
  each invocation it started. `run` resolves when the runner's call does, with `ended`. A run a trigger starts (Create
  Stack, Import Existing Resources, a failure's package answer) runs under a progress notification until it ends
  (`vscode/run-progress.ts`), titled by its action and what it acts on, the stack, else the root (`runTitle`), the
  title its prompts carry too.
- The window's presenter is told the `RunCtx` of the run a notice is about. A failure's notice offers the ways out its
  reason names, Validate on the run's root among them when that root is under a workspace folder, and after them each
  package action that answers the reason, as the package's `answering` lists them (`import-partial`, Import the rest,
  on `import_residual`). The one chosen runs under a progress notification over the failed run's own `RunCtx` object, so
  it reuses the statefile that run was given. The runner's requirement check gates it.

## The canvas tab

- `canvas-panels.ts`: one webview panel per root, created only by `ensure(root, {preserveFocus?})`; two `ensure` calls in
  flight make one panel. A panel opened without focus (a chat tool, a registry add) is created beside the text
  editor the active group holds (`window.activeTextEditor`), so the developer's place stays in view, and in the active
  group when it holds none, where a split would leave an empty group; one opened with focus (**Lace: Open Canvas**) is
  created in the active group, as any editor opens. A panel already open is revealed in its own column.
  The title is the root's name (`rootLabel`: its path in the workspace, the folder's name first
  in a workspace of several folders), with ● while the session is unsaved, and a change of the workspace's folders
  titles it again; a tab whose folder left the workspace stays open on its session, titled by its directory's full
  path. `roots` lists every open panel's root, focused or not: each is a candidate when a surface names its root.
- The page (`canvas-webview/`) shares one postMessage pair between the engine bridge and the host protocol. It boots with
  the host's `boot` call (the root, the kept arrangement, the picked stack), opens the root's session over the bridge,
  and mounts the canvas package's `App` with its ports: `source`, `editor`, `commands`, `context` from the engine
  mapping, `viewState` from what the host kept, and a `presenter` whose notices and confirmations are VS Code's dialogs
  (`vscode/dialogs.ts`: a modal question, or one input box that returns only the exact typed value). It passes the
  host's two contributions (`canvas-webview/contributions.ts`). **Open source**, a host action on each row of the
  canvas's Diagnostics list, sends the host the row's file, line and column (`openSource`), and says so for a diagnostic
  that names no file; the host opens the root's file at that place in the editor beside the canvas, and a file it cannot
  open fails the call with the reason. **Import existing resources**, a host action on the source-refused banner's row
  while the tree is out of lace shape (`requiredContext: ['root', 'needsConversion']`), after the package's Convert,
  with its own `choice` sentence, asks the host to run Import Existing Resources on the panel's root
  (`importResources`), which answers once the import's run has ended.
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
- A directory with no top-level `.tf` opens editable, on the empty module: the module starts on the canvas, and its
  first Generate writes its first `.tf` files. In a workspace where no directory holds Terraform and no canvas is open,
  Open Canvas from the palette opens the canvas of the workspace's folder, the developer's pick in a workspace of
  several folders. The extension writes no source file: Generate, Format, Convert and Import Existing Resources are the
  CLI's writers.
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
- **The host protocol** (`host-protocol.ts`): calls from the page `boot`, `confirm`, `openSource` and
  `importResources`; notices from the page `arrangement`, `notify` (with the failure document of the command it is
  about, when there is one), `unsaved`, `focus`, `generated` (the files the canvas's own Generate wrote); events from
  the host `stack` and `tick`.
- **The registry protocol** (`registry-protocol.ts`): the host sends the page its whole state (`{op: 'state', state}`);
  the page says what the developer did. The registry pages reach no engine.

## Registry sidebar and module detail

- `registry-reads.ts`: `registry list --axis module --limit 500`, `registry get`, `registry describe`, `org current`, each
  in the home. The sidebar reads once, unfiltered, and the page filters as the developer searches and picks categories; a
  row's versions are read on expand. The view reads again when it becomes visible and at each change of the account,
  made in this window or found outside it (see Account).
- The sidebar's states come from a failed list's `reason`: `unauthenticated` → Sign In, `no_organization` → Select
  Organization, anything else its message with Retry. An empty registry shows "No modules are published yet" with the
  publishing guide link the list itself carries.
- Module detail (`module-detail.ts`, one panel per module): `registry get` for the README and versions, `registry
  describe` of the shown version for the interface (it downloads and certifies the version, so it settles later and can
  be refused). Tabs: Details, Interface, Versions, Examples.
- Placement (`place-module.ts`): `nameRoot` (in a workspace with no module, the workspace folder the module starts in),
  `ensure` without focus, a hold for the call, one `place_module`. A refusal is read by its reason: `unauthenticated`
  offers Sign In; `not_lace_form`, `hash_mismatch`, `registry_unavailable`, `not_found`, `version_not_found`,
  `forbidden` are named with the module (any other reason as "the engine refused it"), and **Show Details** writes the
  engine's full message to the "Lace" Output channel.
- Favourites and recently used (five) are keyed on `author/name`, so a new version keeps its star.
- Add Module to Canvas (`add-module.ts`) is a pick of the module axis, on screen while `registry list` is read; a list
  that cannot be read closes it and says why with the ways out its reason names, and an empty registry closes it and
  offers the publishing guide the list carries. The module picked is placed as the sidebar's "+" places it.

## Stacks tree

- `laceStacks` lists the current root's stacks (`stack list --source <root>`), each with its ten latest runs
  (`run list --stack`). The root follows the active canvas (one whose folder is open) and the active `.tf` editor;
  **Show Stacks of a Module** picks it, and is in the view's title bar while more than one root is a candidate (the
  context key `lace.stacks.choice`, set on each read of the tree). The view's description names it (`rootLabel`). A
  change of the workspace's folders reads the tree again, and a root whose folder left the workspace is dropped and
  found again.
- Row actions are the canvas package's bindings run through the runner: `preview`, `apply`, `scan` on a stack,
  `follow-logs`, `run-cancel` on a run; Open in Portal opens the URL the CLI gave the run. A run row's `contextValue`
  is a list of tokens: `laceRun`, then `ended` when its `run list` document carries a `completedAt` and `running` when
  it carries none, then `portal` when the CLI gave the run its page. Each run menu entry's `when` matches a token:
  Cancel Run `running`, Open in Portal `portal` (`__tests__/manifest.test.ts` reads every one against each state a run
  row draws). A run action invoked with no run row says it acts on a run of the Stacks view and runs nothing. The tree
  opens no session: the stack commands run the Terraform on disk. From the palette, Preview, Apply and Scan Stack pick
  a stack of the named root with the one stack pick (`stacks/stack-pick.ts`). A refusal of a stack command names the
  root its run was over, so `no_certification` and `stale_certification` offer Validate on it.
- Selecting a stack picks it for its root (`root-state.ts`), and the root's canvas draws its badges; the tree redraws
  the row picked before and the row picked now, the objects `getChildren` gave (VS Code redraws an element by
  identity). A read of the whole tree drops every row VS Code holds until it settles, and a row's menu command run in
  that time arrives with no row, so only what may change the list reads it whole: a tick, a change of the account, the
  view shown again, a change of the workspace's folders, and Refresh Stacks. Each tick of the runner's store (a run
  started or settled, a scan or a cancel done) re-reads the tree and ticks the canvas of the root that run was about,
  its `RunCtx.root`, whatever the tree ran since. The view draws its progress while the package's `commandUnderWay`
  reads a command under way in the store (the run slot's run, the preview slot's preview, or a command's running
  mark, by the target it runs on) and ends it when it reads none; a follow of a run's logs is a subscription, not a
  command under way, and draws none.
- An apply runs under a cancellable progress notification; every `log` line, the Preview Advisory included, goes to the
  stack's Output channel `Lace: <slug>` (`run-output.ts`), which Follow Logs writes to as well. Its notice offers the
  ways out its failure names; `no_certification` and `stale_certification` offer **Validate**, the palette's Validate
  on the root that apply ran in, whose report lands where the palette's does. An apply held for approval says what the
  Run waits on, from the change request its gate event carries: the change request and its state, each requirement
  with its state and its decider as the gate event names it (Lace, or a change-management system), and each record a
  change-management system keeps, by the system's kind and the record's reference, with the state Lace last read and
  its page, or that it is not opened yet; each record with a page is offered as **Open <kind> <reference>**, which
  opens that page. A preview opens as a read-only `lace-preview:` document once its plan lands: the plan, the policy
  verdict with each policy's own answer when several answer, and the Advisories.
- When the view names no root, the context key `lace.stacks.state` selects the welcome view by the reason `findRoot`
  gives (`rootlessState`): `noFolder` (Open Folder, VS Code's own `workbench.action.files.openFolder`), `noModule` (Open
  Canvas starts one), `severalModules` (Choose Module). When the stacks cannot be listed, it selects the welcome view by
  the failure's reason: `signedOut`, `noOrganization`, `noTeam`, `teamlessOrganization` (Open Portal opens the URL the
  failure carries; the host builds no portal URL), `noStack`, `failed`. Every welcome but the one shown before the first
  read offers exactly one action, a contributed command or one of VS Code's own; welcome text holds no inline code,
  which VS Code draws with its backticks. The tree does not offer `lace stack destroy`; it is a terminal command.
- `noStack`'s action is **Create Stack** (`lace.stacks.create`, not in the palette): the package's `create` binding
  run through the runner over the view's root, under a progress notification ("Create stack: <root>") until its run
  ends. The runner's form asks for the slug and the connection; the package's notice says "Created stack <slug>", and
  its tick reads the tree again, which lists the stack. A refusal is the CLI's, by its reason, through the offers
  (`not_git_repository` and `no_origin_remote` say the CLI's message).
- The one stack pick (`stacks/stack-pick.ts`) lists `stack list --source <root>` and is on screen while the list is
  read; a list that cannot be read closes it and is shown with the ways out its reason names, and a root with no stack
  closes it and says "No stack is deployed from <root> yet. Create one in the Stacks view." No pick is shown empty.
- **Import Existing Resources** (`stacks/import-resources.ts`) is a stack command the host draws: the canvas's
  source-refused banner offers it beside Convert on the panel's root, and **Lace: Import Existing Resources**
  (`lace.importResources`) on the root `rootToAct` names; never on the canvas's toolbar. It picks the stack with the
  one stack pick (a root with no stack stops there), saves the root's dirty `.tf` editors as Convert does, then runs
  the package's `import` binding over `{root, stack}` under a progress notification ("Import existing resources:
  <stack>") until its run ends; the form asks for the statefile. The package's notice says what the import did, and an
  import that stopped at `import_residual` offers Import the rest over the same run's context. Nothing detects a
  statefile and nothing filters the stacks by their state: the CLI refuses a stack that holds state
  (`stack_has_state`).

## Module commands

`commands/authoring-commands.ts`; every command acts on the root `nameRoot` names and says which. With nothing pointed
at, the candidates are the directories that hold Terraform and the roots of the canvases open, focused or not (a canvas
whose folder has left the workspace is under no open folder, and is none); the sole candidate is named without asking, and among several the developer picks. When none is named, `rootToAct` says why by
the reason `nameRoot` gives (no folder is open; no directory holds Terraform and no canvas is open; several are
candidates and the sources have no pick to ask; the folder pointed at is outside the workspace, or is or is inside
`.terraform` or `.lace`, which is not a module directory), and a pick the developer dismissed says nothing. The stack
palette commands (Preview, Apply, Scan Stack, Show Stacks of a Module) and Import Existing Resources name their root the
same way. Open Canvas and
placement name theirs over `startingSources`, whose `start` asks which workspace folder a module starts in where there
is no candidate (a workspace of one folder is not asked); every other surface's sources have no `start`, so a module
command in such a workspace says there is no module: an empty tree has nothing to validate. The Stacks view finds its
root with `findRoot`, which asks nothing, and shows why it found none by that reason's state.

- **Save** and **Generate** run `canvas-operations.ts`, the same functions the chat tools run. Generate first saves the
  root's dirty `.tf` editors, holds the session for the call with no tab, shows its progress, and ends with the files
  written (`generated`: **Show Changes** opens Source Control, the notice the canvas's own Generate ends with too; a
  Generate that wrote no file says that nothing was written and offers nothing) or the engine's refusal (an unsaved
  canvas offers **Save**).
- **Validate**, **Format**, **Scan** and **Generate Docs** run `module validate`, `module fmt`, `module scan`, `module
  docs` through `commands.at(root)`, with no session. **Convert Module** (`lace.convertModule`) runs `module convert` the
  same way and reports as Validate does, with no confirmation (the canvas action has none); an open canvas picks the
  rewritten Terraform up live. Format and Convert are the commands the CLI declares rewrites (`COMMANDS[path].effect`):
  they write the root's Terraform, so they first save its dirty `.tf` editors, as Generate does; Validate, Scan and Generate Docs read the files as they are on disk, as in a terminal. One operation
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
  offers nothing, its message says to run `git init`. A notice that names the root a failure is about offers Validate on
  that root: a module command's, a canvas page's, an apply's, and a notice of the window's runner, whose run's `RunCtx`
  names it. Validate and Convert run through the commands mapping, not the runner: the package's bindings for them hand
  the presenter a verdict line and no document. Generate Docs opens the markdown in an untitled editor and writes
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
`org use`, `team list`, `team use`, `org current`, `team current`, all in the home. Each pick is on screen at once and
fills when its read settles (`vscode/pick.ts`). Selecting an organization goes on to its team: the team pick opens as
the organization is saved, its read `org use` then the teams, listed and saved with `--org` naming the organization just
picked, so the saved team is that organization's even while `LACE_ORGANIZATION` sets another; an organization with no
team closes the pick and says teams are created in the portal, with Open Portal on the page `team list` names
(`createUrl`). A team pick dismissed while the organization is saved still announces the saved organization. The status
bar item shows the selection and runs Select Organization. The account's one change event (`onDidChange`) fires after
each sign-in, sign-out or saved selection this window makes, and when a read of the account differs from the last one. A
read is who is signed in (`whoami`'s user, or the reason its failure gives) and the selection (`org current`,
`team current`); `lace logout` clears only the credentials, so the selection alone cannot see it. The account is read
when the window starts, after each change made here, when the window regains focus (a terminal or another window outside
it) and when a command line running `lace` ends in an integrated terminal with shell integration
(`window.onDidEndTerminalShellExecution`), which changes no focus. The status bar, the registry view and the Stacks tree
read again on the event. Nothing is cached but the last read. A failed account command offers the way out its reason
names (`vscode/offers.ts`).

## The chat tools

The extension contributes tools to VS Code's own chat and nothing else: no chat view, no participant, no MCP server, no
model of Lace's. The tools run in the developer's own model; what each one sends over the network is stated once, in
the README ("The tools run in your own model"), and is what the CLI command the tool runs does in a terminal. The tool
sets are chat-core's (`canvasTools({source, editor, commands})` and `moduleTools({commands})`), each tool a schema and
a handler on chat-core's one tool contract.

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
  folder's name first in a multi-root workspace) or its absolute path, named as a directory pointed at is (`placeOf`):
  any directory there under a workspace folder that is not, and is not inside, `.terraform` or `.lace`, one with no
  Terraform yet included, where the canvas tools start a module; any other is an error listing the directories that
  hold Terraform and the roots of the canvases open;
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
session held, no handler called. Otherwise `invoke` maps the `CancellationToken` to an `AbortSignal` (aborted on
`onCancellationRequested`, the listener disposed when the call settles) and hands it to the tool. A canvas tool stops
at its steps: cancelled while its tab is ensured or its session acquired, it takes no hold (or gives back the one it
took), runs no handler and throws the same `CancellationError`. Once chat-core's handler runs, the signal is its own: a
change cancelled during the call starts nothing further and applies nothing after the cancellation, and the module
tools stop waiting on their command.

**The text level.** `resources/instructions/lace-modules.instructions.md`, contributed through `chatInstructions` and
applied to `**/*.tf`, tells the developer's coding assistant the rules of editing a Lace module's `.tf` files directly.
It names no tool, so it is true wherever the tools are absent (`src/__tests__/instructions.test.ts`).

## Tests

| Project | Files | Needs |
|---|---|---|
| `unit` | `src/**/*.test.ts(x)` | the installed dependencies |
| `build` | `src/**/*.build.test.ts` | the bundles in `out/` (`pnpm build`) |
| `engine` | `src/**/*.engine.test.ts` | the `lace` CLI that `LACE_CLI_VERSION` names, in `bin/` or on `PATH` |

- **Fakes for unit tests**: `engine/__tests__/fake-commands.ts` (one commands mapping and home port whose commands a
  test scripts per path, recording each invocation's directory), `engine/__tests__/fake-engine.ts` (an engine at the
  bridge, so the real caller, mapping and codecs run; its Invoke says `started`, then its exit, as the engine protocol
  orders them), `tools/__tests__/fake-session.ts` (a session over a small Bundle, root sessions with the real rule for
  holders, VS Code's cancellation of a tool call), `roots/__tests__/fake-uri.ts`,
  `diagnostics/__tests__/fake-problems-api.ts`, `vscode/__tests__/fake-messages.ts` (VS Code's message boxes, which hand
  back the button clicked, string or item), `vscode/__tests__/fake-quick-pick.ts` (VS Code's `createQuickPick`: on
  screen from `show()` until hidden, each hiding firing `onDidHide` once, with whether it was busy when it came on
  screen; a test's developer answers each pick once its items are in), `account/__tests__/fake-outside.ts` (what tells
  the window the account may have changed outside it: focus, and a command line ending in an integrated terminal).
- **The real engine**: `engine/__tests__/real-engine.ts` is the one helper every engine test builds on: a git repository
  with module directories, a signed-out developer home of the test's own, an engine with its root sessions and commands
  mapping as one window has them, and cleanups run after each test, latest first. The engine is `bin/lace` when one is
  there, else the `lace` on `PATH` (`engine/__tests__/engine-binary.mjs`, which the window e2e reads too), and it is the
  release `LACE_CLI_VERSION` names: a binary whose `lace version -o json` says another version, any other build of the
  CLI included, is refused before a test runs.
- **The chat tools end to end**: `tools/__tests__/lm-tools.engine.test.ts` invokes every tool `registerLaceTools`
  registers with a `root`, over the real engine, the window's canvas panels (with a stand-in webview panel) and
  commands mapping, signed out; a delete makes no request of the extension's own beyond the engine.
- **The window e2e** (`packages/host-e2e/`, `pnpm --filter @lace-cloud/host-e2e test` after `pnpm build`): Mocha
  suites, bundled by the package's rspack config, that `@vscode/test-cli` runs in a real VS Code against the engine the
  engine tests run (or the binary `LACE_E2E_ENGINE` names, held to the same version). Each run opens two windows, each on
  a fresh git repository of its own whose settings name the engine, with a Lace config directory of the run's own, so
  every case is signed out. `window/` runs in a repository whose tests make their module directories: activation (every
  manifest command registered, an engine of the extension's protocol), the palette's module commands (Validate,
  Generate with no tab, Convert in place), the canvas tab over one session per root (another client's edit, a hand
  edit, the lock, `files.autoSave`, the engine's restart), and an engine that cannot start. `empty/` runs in one that
  holds no Terraform: Open Canvas from the palette starts the module in the workspace's folder.
- **CI** (`.github/workflows/ci.yml`, every PR to `develop`) runs lint, typecheck, the `unit` tests, the build, the
  `build` tests and the `engine` tests on Linux and on Windows, and the window e2e on Linux alone, under `xvfb-run`.
  Both run the release `LACE_CLI_VERSION` names. On Linux the CLI's published installer installs it; on Windows, which
  the installer refuses, the job downloads the release's `lace-cli-windows-amd64-<version>.exe` with its `.sha256` and
  `.minisig` and checks them as the installer does (the checksum, then the signature by the installer's key, whose
  trusted comment names that object and its digest) before it puts the binary on `PATH` as `lace.exe`. `.gitattributes`
  checks every text file out with LF, the line ending biome checks, on Windows too.
- **Nothing in the tests signs in.** What needs a developer who is signed in (the registry, the Stacks tree, the
  organization and team) is unit-tested over scripted commands.
- **Repository tests** in `src/__tests__/`: the manifest against the features (and each run row's menu against the
  run's state), the tracked pins (published versions only, and a lockfile that locks exactly what the manifests name),
  the configuration (every tsconfig include holds tracked files, every workflow runs on `develop` or `main`), the host
  bundle's imports (only `vscode`, `node:*`, `@lace-cloud/host`, `@lace-cloud/canvas/engine`, `@lace-cloud/proto`,
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
