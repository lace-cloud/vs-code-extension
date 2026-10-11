# Lace Cloud

Author Terraform modules on Lace's canvas, inside VS Code.

A Lace module can be worked on at three levels, and you can move between them at any moment: the `.tf` files in the
text editor, the module's canvas (its module instances, the wires between their outputs and inputs, groups, settings and
diagnostics), and your coding assistant in VS Code's chat, which edits the canvas through Lace's tools. Each level shows
what the others did. The canvas is the visual layer between your assistant and the code, and git shows what changed once
the canvas is generated to Terraform.

The extension also brings the Lace registry into a sidebar, lists the stacks deployed from a module with their runs, puts
diagnostics in the Problems panel, and adds palette commands for everything that does not need a selection.

## What you need

- VS Code 1.96 or later, with the folder trusted. Lace runs the Lace CLI and executes Terraform over the folder's content,
  so it does not run in Restricted Mode or in a virtual workspace.
- The Lace CLI. The extension starts it as `lace engine`, from `/usr/local/bin/lace` or from the path in the setting
  `lace.binaryPath`. When the CLI and the extension speak different engine protocols, the extension says which of the two
  to update.
- The module's directory inside a git repository: Generate writes Terraform only there, and git is how you review what it
  wrote.
- A Lace account for the registry, the stacks and the tools' resolving of your words. Sign in from VS Code with
  **Lace: Sign In**.
- For **Lace: Generate Docs**, [terraform-docs](https://terraform-docs.io). Without it, the notification names it with an
  **Install** link; Lace does not install it. **Lace: Scan Module** needs nothing of yours: `lace module scan` runs
  [tfsec](https://github.com/aquasecurity/tfsec) at the version Lace pins, the one on `PATH` when it is that version,
  else the pinned release, downloaded once, checked against its checksum and kept in `~/.lace/bin`.

## Getting started

1. Open the folder that holds your Terraform, and trust it.
2. Run **Lace: Open Canvas** from the Command Palette, or right-click a folder in the Explorer and choose it there.
3. Work on the canvas. Place modules from the **Registry** view in the Lace activity bar.
4. Save the canvas (the canvas's Save button, `Cmd+S` / `Ctrl+S` while the canvas has focus, or **Lace: Save**).
5. Run **Generate** (the canvas's button or **Lace: Generate**). Lace writes the `.tf` files; **Show Changes** opens
   Source Control, where git shows the diff.

Each entry of the canvas's Diagnostics list has **Open source**, which opens the file the diagnostic names at its line
and column, beside the canvas. For one located on the canvas alone, such as a required input not set, it says the
diagnostic names no file.

A directory with no `.tf` file opens with the canvas locked and the engine's message, and a notification offers
**Create main.tf**: it opens an untitled `main.tf` in that directory, and your save is the write. The extension writes no
Terraform of its own; only Generate, Format and Convert write source files.

## Modules, canvases and authoring sessions

**A module directory** (Lace calls it an *authoring root*) is any directory under a workspace folder that holds a `.tf`
file. A workspace can hold several, such as `infra/prod` and `infra/staging`; `.terraform` and `.lace` directories are not
module directories. Every Lace surface acts on one module directory, chosen in this order: the directory you pointed at
(an Explorer folder, a Stacks row, a tool's `root`); else the module of the active canvas tab; else the directory of the
active `.tf` editor; else the one module directory in the workspace, or your pick among several. Each command says which
module it acted on. When none can be named it says why, such as a folder inside `.terraform`; dismissing the pick ends
the command quietly.

**One canvas tab per module directory.** Its title is the directory's path in the workspace (in a workspace of several
folders, the folder's name first), with ● while the canvas holds unsaved edits.

**One authoring session per module directory.** The canvas tab, the palette commands and the chat tools all work on the
same session, so an edit made through any of them is what the others show next. A text edit to a `.tf` file reaches the
open canvas live. The session lasts while the module's canvas tab is open, and closing the tab ends it; a command or a
tool that needs the session while no tab is open holds it for that call only.

**Unsaved, saved, generated.** A canvas edit is unsaved until it is saved; Save writes the canvas to
`.lace/.canvas/state.lace`. Generate renders the saved canvas to the module's `.tf` files. A text edit made while the
canvas holds edits the files do not have yet is a conflict: the canvas asks you to keep the canvas edits or reload the
files, and one side is taken whole. To edit the files by hand, generate first.

**Lace style.** Lace style is the form of Terraform the canvas works in, and `lace module validate` says whether a module
is in it. The first
Generate on a hand-written module writes it in that style: comments, blank lines, argument order and the file a block sits
in are not carried through. A module whose Terraform does not parse opens with the canvas locked until it parses again.

## Saving follows `files.autoSave`

The canvas saves when VS Code's own `files.autoSave` setting says, read for the module's workspace folder. There is no
Lace setting for it.

| `files.autoSave`   | When the canvas saves                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `off`              | Only when you save. Closing the canvas tab discards unsaved edits.                                                                                     |
| `afterDelay`       | `files.autoSaveDelay` after the latest edit.                                                                                                           |
| `onFocusChange`    | When the canvas loses focus, when the window does, and as soon as an edit lands while the canvas does not have focus (an edit from a tool or the registry). |
| `onWindowChange`   | When the window loses focus.                                                                                                                           |

With any mode but `off`, closing the canvas tab or the window saves unsaved edits first. A save cannot run while the
module's Terraform does not parse, and the save at window close has the few seconds VS Code gives an extension to stop.

## Diagnostics in the Problems panel

While a module's canvas is open, the Problems panel shows what its canvas lists: the engine's live diagnostics, the
module's latest Validate or Convert report (or the validate a Generate runs), and its latest Scan. Entries are labelled
`lace`. A report is dropped, whole, once the module's files change after it, and every entry clears when the canvas tab
closes. A diagnostic with a file but no line is placed at line 1. One that names no file, such as a required input
not set, has no place in a file and stays on the canvas's Diagnostics list.

With no canvas open, **Lace: Validate Module** and **Lace: Scan Module** report as commands do: a notification with the
verdict, when Validate reached one, and the number of diagnostics, whose **Show Report** writes each diagnostic with its
file and line to the "Lace" Output channel. Nothing goes to Problems then, since nothing would clear it when the files
change.

## The Registry view and module detail

The **Registry** view in the Lace activity bar lists the modules of the Lace registry: search, category filters,
favourites (the star), recently used, your organization's modules and the public ones, each grouped by system. Expand a
row for its versions. The organization shown is the one the Lace CLI has selected; its picker runs
**Lace: Select Organization**.

- **+** on a row places that version on the canvas of the module you are working in. The canvas tab opens or comes
  forward without taking focus, so you see the edit land.
- Clicking a row opens **module detail**: **Details** renders the module's README, **Interface** lists its inputs and
  outputs as Lace certified them (describing a version downloads and certifies it, so it loads after the rest),
  **Versions** and **Examples**, with **Add to Canvas** in the header.
- Signed out, the view offers **Sign In**; with no organization selected, **Select Organization**; with no module
  published, it says so and links to the guide on publishing one.
- A placement the registry refuses says why, naming the module; **Show Details** opens the full message in the "Lace"
  Output channel.

## The Stacks view

The **Stacks** view lists the stacks deployed from the current module directory (`lace stack list --source`), each with
its ten most recent runs. The view's description names the module; it follows the canvas or `.tf` file you turn to, and
**Lace: Show Stacks of a Module** in its title bar picks another.

- On a stack: **Preview**, **Apply** and **Scan for Drift**. On a run: **Follow Logs**, **Cancel Run** and
  **Open in Portal**.
- Selecting a stack picks it for its module, and the module's canvas draws that stack's badges on its nodes.
- **Apply** runs under a progress notification you can cancel. Every line it prints, the Preview Advisory included, goes to
  the stack's Output channel ("Lace: *stack*"), which **Follow Logs** writes to as well. A module with no current
  certification offers **Validate**.
- **Preview** opens the plan and the policy verdict as a read-only document.
- The stack commands run the Terraform on disk, not the canvas: generate canvas edits before you preview or apply them.
  Per-environment values are `--var-file` and `--var` on `lace stack preview` and `lace stack apply` in a terminal.
  Tearing a stack down is `lace stack destroy` in a terminal.
- When the stacks cannot be listed, the view says why with the one action that gets past it: **Sign In**,
  **Select Organization**, **Select Team**, **Open Portal** (an organization with no team; teams are created in the
  portal), **Create Stack in Terminal** (no stack deployed from the module yet), or **Retry**.
- A stack is created once, in a terminal. **Create Stack in Terminal** types
  `lace stack create SLUG --source . --connection CONNECTION_ID`, with the CLI at `lace.binaryPath` written as the shell of
  your default terminal profile calls a program (PowerShell, Command Prompt, fish, nushell or a POSIX shell), into a
  terminal at the module directory, unsent: replace `SLUG` with the new stack's slug and `CONNECTION_ID` with the ID of
  the cloud connection it deploys through (`conn_…`, as `lace connection list` lists them), then run it. Preview, Apply
  and Scan Stack from the Command Palette on a module with no stack say so. The stack is bound to the module's place in
  its git repository, and the view lists it once you refresh.

## Sign-in, organization and team

**Lace: Sign In** runs `lace login`: it shows the confirmation code once, with **Copy Code**, and opens the sign-in page.
**Lace: Sign Out** runs `lace logout`. The extension keeps no credentials; the CLI reads them for every command.

The organization and team every scoped command runs in are the CLI's own selection, saved by `lace org use` and
`lace team use`, so a terminal and VS Code always agree. **Lace: Select Organization** picks an organization and goes on
to its team; **Lace: Select Team** picks a team of the current organization, and for an organization with no team
offers **Open Portal** on the page that makes one. The status bar shows the selection, and clicking it selects an
organization. When `LACE_ORGANIZATION` or `LACE_TEAM` is set in the engine's environment, that variable decides, and the
pick says so.

## Lace in VS Code's chat

Lace adds tools to VS Code's own chat. There is no Lace chat view: your coding assistant, in agent mode, calls Lace's
tools as it calls any other, and you can name one with `#` (for example `#laceChangeModuleCanvas`). Every tool takes
`root`, the module directory, as its path in the workspace (`infra/prod`, or `.` for the workspace folder itself; in a
workspace of several folders, the folder's name first).

| Tool                             | Reference                      | What it does                                                                                                                                                             |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lace_change_module_canvas`      | `#laceChangeModuleCanvas`      | Changes the canvas from your words, one change per entry: place a registry module, connect, disconnect, set or clear an input, bind it to a variable, rename, delete, ungroup. |
| `lace_describe_module_canvas`    | `#laceDescribeModuleCanvas`    | Describes the canvas: instances with their inputs and outputs, wires, groups, diagnostics, and whether it holds unsaved or ungenerated edits.                             |
| `lace_save_module_canvas`        | `#laceSaveModuleCanvas`        | Saves the canvas, when you ask.                                                                                                                                          |
| `lace_generate_module_terraform` | `#laceGenerateModuleTerraform` | Generates the saved canvas to Terraform, when you ask, and reports the files written or why Lace did not generate.                                                      |
| `lace_validate_module_terraform` | `#laceValidateModuleTerraform` | Runs `lace module validate` on the Terraform on disk and returns the verdict and the diagnostics.                                                                        |
| `lace_search_module_registry`    | `#laceSearchModuleRegistry`    | Searches the Lace registry by words, system and category.                                                                                                                |
| `lace_describe_registry_module`  | `#laceDescribeRegistryModule`  | Describes a registry module before it is placed: inputs, outputs, version and certification verdict.                                                                    |

**How Lace's canvas tools resolve what you ask for.** Your assistant passes your words, one entry per change, with its
own reading of each: the operation it understood and the names you used as the canvas lists them, never a value, and its
other reading where your words could mean two changes. Lace lists what the canvas offers for every choice a change needs
(which operation, instance, input or output, registry module, and for a connection which output feeds which input) and
settles each choice in order: a name you used settles it first, exactly or ignoring case; otherwise Lace's ranking, run
by Lace, and your assistant's reading are combined, and Lace's pick stands only where its ranking is sure of it. The tool
then applies the change, and its result says what was applied and how each choice was made.

- Where Lace's ranking was not sure, your assistant's reading stood, and the result marks each such choice.
- Where Lace's ranking was sure and your assistant read another candidate, Lace's pick is applied and the result says
  both, so your assistant can tell you. The edit is on the canvas, one undo away.
- When neither settles a choice, nothing is applied for that change, and the result names the choice and its candidates.
- When your assistant gave a second reading and Lace's ranking is sure it means another change, nothing is applied and
  the result shows both readings, so your assistant asks you which you meant.
- Signed out, or when Lace's ranking cannot be reached, your assistant's reading alone decides each choice your words
  leave open.

- The change tool opens or brings forward the module's canvas tab without taking focus, so every edit lands where you can
  see it, one undo step each.
- Every result carries the current canvas. Values an input marks `sensitive` are withheld.
- No tool asks for confirmation. The save and generate tools tell your assistant to call them only when you ask.
  Describe and Generate open no tab; Save acts only on a canvas that is open, since unsaved edits exist only there.
- The validate tool and the two registry tools run as commands and take no session.

**What Lace learns from.** Signed in, each question Lace's ranking is asked is kept by Lace as it was asked, to train
the ranking: your words with every value you gave replaced by a placeholder, your assistant's readings held the same
way, and the candidates Lace weighed (the canvas's own names and descriptions, never what an input is set to), with
their scores. A change whose words still hold one of those values inside a longer word is not sent to Lace's ranking at
all. Once the tool's call settles, the decision for each change your words did not settle by name alone is reported:
how each choice was made, and what was applied, every value replaced. What happened to the change next is reported too,
each once: undone, changed to another choice through the tool or by hand, saved, or generated. Each request carries
your Lace credential, read for that request from the Lace CLI. Signed out, nothing is sent.

Where VS Code's Language Model Tools API is not available (Cursor and other forks), the extension runs without its
tools; your assistant works on the `.tf` files and with the `lace` CLI, and the canvas follows the files.

Your assistant editing the `.tf` files directly is a level of its own. The extension contributes instructions for it that
apply to `.tf` files: a Lace module stays in Lace style and `lace module validate` says whether it is, generate pending
canvas edits before editing `.tf` by hand, Generate does not keep comments or layout, a group is a child module,
per-environment values go to the stack commands, and a conflict or a locked canvas is yours to resolve on the canvas.

## The Lace engine

The extension runs one Lace engine per window, started when something first needs it. The status bar shows its state
(**Lace Engine: running**); clicking it opens the "Lace" Output channel. The engine exits with the window, and with
`lace.autoRestart` on it is restarted when it exits unexpectedly.

## Commands

| Command                              | ID                             | What it does                                                                                                     |
| ------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Lace: Open Canvas                    | `lace.openCanvas`              | Opens the module's canvas tab. Also on the Explorer folder menu.                                                 |
| Lace: Save                           | `lace.save`                    | Saves the module's open canvas; with none open there is nothing unsaved, and it says so.                         |
| Lace: Generate                       | `lace.generate`                | Generates the saved canvas to the module's `.tf` files, with no tab, after saving the module's open `.tf` editors. |
| Lace: Validate Module                | `lace.validateModule`          | Runs `lace module validate` on the module's Terraform and writes its certification under `.lace/`.              |
| Lace: Convert Module                 | `lace.convertModule`           | Runs `lace module convert`, which rewrites the module's Terraform in Lace style, and reports as Validate does; an open canvas picks the rewritten files up. |
| Lace: Format Module                  | `lace.formatModule`            | Runs `lace module fmt` and names the files it changed.                                                           |
| Lace: Scan Module                    | `lace.scanModule`              | Runs `lace module scan` (tfsec).                                                                                 |
| Lace: Generate Docs                  | `lace.generateDocs`            | Runs `lace module docs` (terraform-docs) and opens the markdown in an untitled editor; your save is the write. Also on the Explorer folder menu. |
| Lace: Add Module to Canvas           | `lace.addModuleToCanvas`       | Picks a registry module and places it on the module's canvas.                                                    |
| Lace: Refresh Registry               | `lace.refreshRegistry`         | Reads the registry again.                                                                                        |
| Lace: Sign In                        | `lace.signIn`                  | Signs in to Lace.                                                                                                |
| Lace: Sign Out                       | `lace.signOut`                 | Signs out of Lace.                                                                                               |
| Lace: Select Organization            | `lace.selectOrganization`      | Selects the organization, then its team.                                                                         |
| Lace: Select Team                    | `lace.selectTeam`              | Selects a team of the current organization.                                                                      |
| Lace: Refresh Stacks                 | `lace.refreshStacks`           | Lists the stacks again.                                                                                          |
| Lace: Show Stacks of a Module        | `lace.stacks.chooseModule`     | Picks the module whose stacks the Stacks view lists.                                                             |
| Lace: Preview Stack                  | `lace.previewStack`            | Previews a stack of the module: its row's, or one you pick.                                                      |
| Lace: Apply Stack                    | `lace.applyStack`              | Applies a stack of the module: its row's, or one you pick.                                                       |
| Lace: Scan Stack for Drift           | `lace.scanStack`               | Scans a stack of the module for drift: its row's, or one you pick.                                               |
| Lace: Follow Logs                    | `lace.followRunLogs`           | Follows a run's logs in the stack's Output channel. On a run row.                                                |
| Lace: Cancel Run                     | `lace.cancelRun`               | Cancels a run. On a run row.                                                                                     |
| Lace: Open in Portal                 | `lace.openRunInPortal`         | Opens a run's page in the Lace portal. On a run row.                                                             |
| Lace: Open Portal                    | `lace.stacks.openPortal`       | Opens the portal page the Stacks view's failure names. In the view.                                              |
| Lace: Create Stack in Terminal       | `lace.stacks.createInTerminal` | Types `lace stack create`, with placeholders, into a terminal at the module directory. In the view.          |
| Lace: Start Engine                   | `lace.startEngine`             | Starts the Lace engine.                                                                                          |
| Lace: Stop Engine                    | `lace.stopEngine`              | Stops the Lace engine.                                                                                           |
| Lace: Restart Engine                 | `lace.restartEngine`           | Restarts the Lace engine.                                                                                        |
| Lace: Open Logs                      | `lace.openLogs`                | Shows the "Lace" Output channel.                                                                                 |

The module commands act on the module directory chosen as described above. Validate, Convert, Format, Scan and Generate
Docs run on the module's files as the same command typed in a terminal there would, and open no session. Generate,
Format and Convert write the module's `.tf` files, so they save its open `.tf` editors first; Validate, Scan and Generate
Docs read the files as they are on disk, as the chat's validate tool and the canvas's Validate do, and write nothing.
Lace binds no keys of its own.

## Settings

| Setting            | Default               | What it does                                                                  |
| ------------------ | --------------------- | ----------------------------------------------------------------------------- |
| `lace.binaryPath`  | `/usr/local/bin/lace` | The Lace CLI the engine runs from. Machine-overridable.                       |
| `lace.autoRestart` | `true`                | Restart the Lace engine when it exits unexpectedly.                           |

Lace also reads VS Code's `files.autoSave` and `files.autoSaveDelay` (see above).

## Links

- [Documentation](https://lace.cloud)
- [Report an issue](https://github.com/lace-cloud/vs-code-extension/issues)
- [Source and contributing](https://github.com/lace-cloud/vs-code-extension): building the extension is in its
  `CLAUDE.md` and `AGENTS.md`
