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
- The Lace CLI. The extension starts it as `lace engine`: the `lace` on your `PATH`, where the CLI's install puts it, or
  the executable whose full path the setting `lace.binaryPath` names. On Windows that executable is `lace.exe`, and
  `where.exe lace` prints its path; the extension runs no `.cmd` or `.bat` shim, so name the `.exe`. In a remote window
  (Remote - SSH, WSL, a dev container, Codespaces) or `code serve-web`, the setting is the machine's: set it under the
  **Remote** tab of Settings, to the CLI's path on that machine. The extension speaks engine protocol 7, which Lace CLI
  v2.53.0 speaks; when the CLI and the extension speak different engine protocols, the extension says which of the two
  to update.
- The module's directory inside a git repository: Generate writes Terraform only there, and git is how you review what it
  wrote.
- A Lace account for the registry and the stacks. Sign in from VS Code with **Lace: Sign In**.
- For **Lace: Generate Docs**, [terraform-docs](https://terraform-docs.io). Without it, the notification names it with an
  **Install** link; Lace does not install it. **Lace: Scan Module** needs nothing of yours: `lace module scan` runs
  [tfsec](https://github.com/aquasecurity/tfsec) at the version Lace pins, the one on `PATH` when it is that version,
  else the pinned release, downloaded once, checked against its checksum and kept in `~/.lace/bin`.

## Getting started

1. Open the folder that holds your Terraform, or the folder your module starts in, and trust it.
2. Run **Lace: Open Canvas** from the Command Palette, or right-click a folder in the Explorer and choose it there.
3. Work on the canvas. Place modules from the **Registry** view in the Lace activity bar.
4. Save the canvas (the canvas's Save button, `Cmd+S` / `Ctrl+S` while the canvas has focus, or **Lace: Save**).
5. Run **Generate** (the canvas's button or **Lace: Generate**). Lace writes the `.tf` files and names the ones it
   changed; **Show Changes** opens Source Control, where git shows the diff.

Under the module's `.lace/` directory, a stack's **Apply** reads `verdict.json`, `bundle.pb` and `tree-manifest.json`
from the working tree, never from git, and the pre-commit hook that `lace hooks install` writes stages them;
`.lace/.canvas/state.lace` is the module's canvas state, derived from the `.tf` files when it is absent, or when its
base differs from them and it holds no edits the files lack; `.lace/.canvas/state.lace.lock` is the running engine's
lock.

Each entry of the canvas's Diagnostics list has **Open source**, which opens the file the diagnostic names at its line
and column, beside the canvas. For one located on the canvas alone, such as a required input not set, it says the
diagnostic names no file.

A directory with no `.tf` file opens an empty canvas you can edit: the module starts there, as it would in a new `.tf`
file, and Generate writes its first `.tf` files. In a workspace with no `.tf` file and no canvas open, **Lace: Open
Canvas** from the Command Palette and placing a registry module start the module in the workspace folder; in a
workspace of several folders you pick which. The extension writes no Terraform of its own; only Generate, Format,
Convert and Import Existing Resources write source files.

## Modules, canvases and authoring sessions

**A module directory** (Lace calls it an *authoring root*) is any directory under a workspace folder that holds a `.tf`
file, or one with none yet whose module you start on the canvas. A workspace can hold several, such as `infra/prod` and
`infra/staging`; `.terraform` and `.lace` directories are not module directories. Every Lace surface acts on one module
directory, chosen in this order: the directory you pointed at (a folder you right-click in the Explorer, a Stacks row, a
tool's `root`); else the module of the active canvas tab; else the directory of the active `.tf` editor; else the one
module directory in the workspace, a directory holding `.tf` files or one whose canvas is open, or your pick among
several; else, for **Lace: Open Canvas** and placing a registry module, the workspace folder, where the module starts.
When none can be named, the command says why, such as a folder inside `.terraform`; dismissing the pick ends the command
quietly.

A module directory has one name: its path in the workspace, with the folder's name first in a workspace of several
folders, and the folder's name for a workspace folder itself. The module commands say it in their progress and their
results, and the canvas tab, the Stacks view's description and the chat tools' results name the module by it;
**Preview**, **Apply** and **Scan for Drift** name the stack they act on instead.

**One canvas tab per module directory.** Its title is the directory's name, with ● while the canvas holds unsaved edits.
A tab whose folder you remove from the workspace stays open, titled by the directory's full path; its own toolbar
still works, and no other surface names it as a module directory.

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
in are not carried through. A module whose own `.tf` declares managed resources is not in Lace style: its canvas opens
read-only, and its banner says "This Terraform is not in lace shape yet" and offers two choices. **Convert** runs
`lace module convert`, which restructures the module in place, each of those resources composed into a module of its
own, so a stack's apply creates only what its state does not hold yet. **Import existing resources** restructures it the
same way and adds import blocks from a statefile you pick, so an empty stack's first apply adopts the resources that
statefile records instead of creating them again (see the Stacks view). A module whose Terraform does not parse opens
with the canvas locked until it parses again.

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
row for its versions. The **Organization** dropdown under the search shows the organization the Lace CLI has selected;
it runs **Lace: Select Organization** to switch it.

- **+** on a row places that version on the canvas of the module you are working in. The canvas tab opens beside the
  file you are editing, or comes forward, without taking focus, so you see the edit land.
- Clicking a row opens **module detail**: **Details** renders the module's README, **Interface** lists its inputs and
  outputs as Lace certified them (describing a version downloads and certifies it, so it loads after the rest),
  **Versions** and **Examples**, with **Add to Canvas** in the header.
- Signed out, the view offers **Sign In**; with no organization selected, **Select Organization**; with no module
  published, it says so and links to the guide on publishing one. A sign-in, sign-out or organization picked in a
  terminal reaches the view as described under [Sign-in, organization and team](#sign-in-organization-and-team).
- A placement the registry refuses says why, naming the module; **Show Details** opens the full message in the "Lace"
  Output channel.

## The Stacks view

The **Stacks** view lists the stacks deployed from the current module directory (`lace stack list --source`), each with
its ten most recent runs. The view's description names the module; it follows the canvas or `.tf` file you turn to, and
**Lace: Show Stacks of a Module**, in its title bar while the workspace holds more than one module, picks another.

- On a stack: **Preview**, **Apply** and **Scan for Drift**. On a run: **Follow Logs**, **Cancel Run** while the run
  has not ended, and **Open in Portal** when the run has a page there.
- Selecting a stack picks it for its module, and the module's canvas draws that stack's badges on its nodes.
- **Apply** runs under a progress notification you can cancel. Every line it prints, the Preview Advisory included, goes to
  the stack's Output channel ("Lace: *stack*"), which **Follow Logs** writes to as well. An apply held for approval
  names the change request the run waits on: each requirement with its state and whether Lace or a change-management
  system decides it, and each record that system keeps, with its state and **Open** on the record's page.
- **Preview** opens the plan, the policy verdict and the Advisories of the Agents bound at Preview as a read-only
  Lace Plan document, whose lines wrap.
- A stack command refused because the module has no current certification offers **Validate**, which validates that
  module.
- The stack commands run the Terraform on disk, not the canvas: generate canvas edits before you preview or apply them.
  Per-environment values are `--var-file` and `--var` on `lace stack preview` and `lace stack apply` in a terminal.
  Tearing a stack down is `lace stack destroy` in a terminal. A `lace` command that may change a stack, run in
  VS Code's integrated terminal, lists the stacks again when it ends, and the module's canvas reads its badges again;
  for one run elsewhere, **Lace: Refresh Stacks** does the same.
- With no module to list the stacks of, the view says why: no folder is open, with **Open Folder**; no directory holds a
  module yet, with **Open Canvas** to start one; or several do, with **Choose Module** to pick one.
- When the stacks cannot be listed, the view says why with the one action that gets past it: **Sign In**,
  **Select Organization**, **Select Team**, **Open Portal** (an organization with no team; teams are created in the
  portal), **Create Stack** (no stack deployed from the module yet), or **Retry**.
- **Create Stack** (`lace.stacks.create`) creates a stack of the module the view lists (`lace stack create`): it asks
  for the new stack's slug, proposing the module directory's name, then for the cloud connection it deploys through,
  picked from your team's connections as `lace connection list` lists them, and creates it under a progress
  notification. The stack is bound to the module's place in its git repository, and the view lists it. A team
  with no cloud connection yet is told so, with **Open Portal**, where connections are added. **Preview**, **Apply** and
  **Scan for Drift** from the Command Palette on a module with no stack say to create one in the Stacks view.
- **Lace: Import Existing Resources** (`lace.importResources`), also on the canvas's banner for a module not in Lace
  style, adopts resources that already exist into a stack of the module (`lace stack import`): you pick the stack,
  then the statefile that records them, any file you name. It saves the module's open `.tf` editors, then restructures
  the module as Convert does and writes an import block for each resource the statefile records, under a progress
  notification. Review the change in git, commit it, then apply the stack to adopt them. An import that cannot derive
  an import ID for some resources writes nothing and offers **Import the rest**, which names them, then imports the
  others from the same statefile under a progress notification and leaves those to be created anew. Lace refuses an
  import into a stack that already holds state.

## Sign-in, organization and team

**Lace: Sign In** runs `lace login`: it shows the confirmation code once, with **Copy Code**, and opens the sign-in page.
**Lace: Sign Out** runs `lace logout` and says what became of this machine's API key: revoked, or not revoked and why.
While the key may still be live, the notice is a warning, and **Open Portal** opens the page where you revoke it. The
extension keeps no credentials; the CLI reads them for every command.

The organization and team every scoped command runs in are the CLI's own selection, saved by `lace org use` and
`lace team use`, so a terminal and VS Code always agree. **Lace: Select Organization** picks an organization and goes on
to its team; **Lace: Select Team** picks a team of the current organization, and for an organization with no team
offers **Open Portal** on the page that makes one. The status bar shows the selection, and clicking it selects an
organization. When `LACE_ORGANIZATION` or `LACE_TEAM` is set in the engine's environment, that variable decides, and the
pick says so.

A `lace login`, `lace logout`, `lace org use` or `lace team use` run in VS Code's integrated terminal reaches the status
bar, the Registry view and the Stacks view when the command ends (the terminal's shell integration, on by default,
tells VS Code it ended); one run in a terminal outside VS Code, when the window regains focus.

## Lace in VS Code's chat

Lace adds tools to VS Code's own chat. There is no Lace chat view and no model of Lace's: your coding assistant, in agent
mode, calls Lace's tools as it calls any other, and you can name one with `#` (for example `#laceChangeModuleCanvas`).
Every tool takes `root`, the module directory, as its path in the workspace (`infra/prod`, or `.` for the workspace
folder itself; in a workspace of several folders, the folder's name first). A directory with no `.tf` file yet is a
module directory too: the canvas tools start its module there.

**The tools run in your own model.** Your conversation stays between you and the model you chose in VS Code; Lace runs
no model of its own on it, and the conversation itself is never sent. A tool reaches the network only as the same Lace
CLI command does in a terminal. A request the Lace CLI makes to Lace carries your Lace credential and the organization
you selected; the requests Terraform makes carry no credential of yours (see validate below):

- `lace_search_module_registry` sends Lace's registry the search words, system and category your assistant gave it
  (`lace registry list`).
- `lace_describe_registry_module` sends the module and version, and downloads that version from Lace's registry to
  describe it (`lace registry describe`).
- A change that places a module sends the module's name to Lace's registry to find it, and the module it adds is fetched
  from the registry.
- `lace_validate_module_terraform`, and `lace_generate_module_terraform` after it writes the Terraform, run Terraform as
  `lace module validate` does. On first use the Lace CLI downloads Terraform from HashiCorp's releases
  (`releases.hashicorp.com`) and keeps it under `~/.lace/bin`; later runs do not contact HashiCorp's releases. Terraform
  checks HashiCorp for a newer version (`checkpoint-api.hashicorp.com`) when it runs, which can happen on every validate
  when another Terraform version is on your PATH; `CHECKPOINT_DISABLE=1` in the environment turns that off. The module's
  providers come from Lace's provider mirror, or from the public Terraform registry when your organization has a
  break-glass grant; when you are signed in with an organization selected, validate asks Lace which grant is active (the
  tool names no organization of its own). The module's `lace.cloud/` modules come from Lace's registry. Terraform's
  requests to Lace's provider mirror and registry carry no credential of yours: the CLI keeps your Lace credential out
  of Terraform's environment, and Terraform reaches the registry with a read token the CLI mints for your selected
  organization, only when the module calls a `lace.cloud/` module (`lace module validate --help`).

Describing and saving the canvas, and every change other than placing a module, work only on your files and the Lace
engine on your machine.

| Tool                             | Reference                      | What it does                                                                                                                                                             |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lace_change_module_canvas`      | `#laceChangeModuleCanvas`      | Changes the canvas, one change per entry: place a registry module, connect, disconnect, set or clear an input, bind it to a variable, rename, delete, ungroup. |
| `lace_describe_module_canvas`    | `#laceDescribeModuleCanvas`    | Describes the canvas: instances with their inputs and outputs, wires, groups, diagnostics, and whether it holds unsaved or ungenerated edits.                             |
| `lace_save_module_canvas`        | `#laceSaveModuleCanvas`        | Saves the canvas, when you ask.                                                                                                                                          |
| `lace_generate_module_terraform` | `#laceGenerateModuleTerraform` | Generates the saved canvas to Terraform, when you ask, and reports the files it changed and removed or why Lace did not generate.                                     |
| `lace_validate_module_terraform` | `#laceValidateModuleTerraform` | Runs `lace module validate` on the Terraform on disk and returns the verdict and the diagnostics.                                                                        |
| `lace_search_module_registry`    | `#laceSearchModuleRegistry`    | Searches the Lace registry by words, system and category.                                                                                                                |
| `lace_describe_registry_module`  | `#laceDescribeRegistryModule`  | Describes a registry module before it is placed: inputs, outputs, version and certification verdict.                                                                    |

**How Lace's canvas tools resolve what you ask for.** Your assistant reads what you ask and states each change as the
canvas lists it: the operation (place, connect, disconnect, set, bind, clear, rename, delete, ungroup), the instance,
input, output or registry module it works on by the name the canvas gives it, and the literal you gave (an input's
value, a new name, the variable an input is bound to) in a slot of its own. Each name settles in order: exactly, then
ignoring case. The changes apply in the order given, each on the canvas the one before it left, and the result says
what was applied.

- A name that matches nothing, a name that fits several things, or a choice the change leaves open applies nothing for
  that change, and the result lists the candidates the canvas offers, so your assistant can ask you or send the change
  again naming one. The call's other changes still apply.
- A place whose module the registry lists nothing for applies nothing and lists no candidates: the result points your
  assistant to `lace_search_module_registry` to find the module.
- A connection that names no output and no input wires the two instances as the canvas does when you drag one onto the
  other; pairs that tie come back for you to choose between.
- A registry module named with a version (`author/name@version`) is placed at that version.

- The change tool opens the module's canvas tab beside the file you are editing, or brings it forward, without taking
  focus, so every edit lands where you can see it, one undo step each.
- Every result carries the current canvas. Values an input marks `sensitive` are withheld.
- No tool asks for confirmation. The save and generate tools tell your assistant to call them only when you ask.
  Describe and Generate open no tab; Save acts only on a canvas that is open, since unsaved edits exist only there.
- The validate tool and the two registry tools run as commands and take no session.

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

An engine that does not start says where the CLI was read from (`lace.binaryPath`) and what happened. When no executable
is found there, it also says to install the Lace CLI so `lace` is on your `PATH`, or to set `lace.binaryPath` to the
full path of its executable.

## Commands

| Command                              | ID                             | What it does                                                                                                     |
| ------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Lace: Open Canvas                    | `lace.openCanvas`              | Opens the module's canvas tab; in a workspace with no module, starts one in the workspace folder. Also on the Explorer folder menu. |
| Lace: Save                           | `lace.save`                    | Saves the module's open canvas; with none open there is nothing unsaved, and it says so.                         |
| Lace: Generate                       | `lace.generate`                | Generates the saved canvas to the module's `.tf` files, with no tab, after saving the module's open `.tf` editors. |
| Lace: Validate Module                | `lace.validateModule`          | Runs `lace module validate` on the module's Terraform and writes its certification under `.lace/`.              |
| Lace: Convert Module                 | `lace.convertModule`           | Runs `lace module convert`, which rewrites the module's Terraform in Lace style, and reports as Validate does; an open canvas picks the rewritten files up. |
| Lace: Import Existing Resources      | `lace.importResources`         | Runs `lace stack import` on a stack of the module you pick, with a statefile you pick: converts the module as Convert does and adds an import block for each resource the statefile records. Also on the canvas's banner. |
| Lace: Format Module                  | `lace.formatModule`            | Runs `lace module fmt` and names the files it changed.                                                           |
| Lace: Scan Module                    | `lace.scanModule`              | Runs `lace module scan` (tfsec).                                                                                 |
| Lace: Generate Docs                  | `lace.generateDocs`            | Runs `lace module docs` (terraform-docs) and opens the markdown in an untitled editor; your save is the write. Also on the Explorer folder menu. |
| Lace: Add Module to Canvas           | `lace.addModuleToCanvas`       | Picks a registry module and places it on the module's canvas; in a workspace with no module, on the canvas of the workspace folder, where the module starts. |
| Lace: Refresh Registry               | `lace.refreshRegistry`         | Reads the registry again.                                                                                        |
| Lace: Sign In                        | `lace.signIn`                  | Signs in to Lace.                                                                                                |
| Lace: Sign Out                       | `lace.signOut`                 | Signs out of Lace.                                                                                               |
| Lace: Select Organization            | `lace.selectOrganization`      | Selects the organization, then its team.                                                                         |
| Lace: Select Team                    | `lace.selectTeam`              | Selects a team of the current organization.                                                                      |
| Lace: Refresh Stacks                 | `lace.refreshStacks`           | Lists the stacks again, and the module's canvas reads its stack badges again.                                    |
| Lace: Show Stacks of a Module        | `lace.stacks.chooseModule`     | Picks the module whose stacks the Stacks view lists.                                                             |
| Lace: Preview Stack                  | `lace.previewStack`            | Previews a stack of the module: its row's, or one you pick.                                                      |
| Lace: Apply Stack                    | `lace.applyStack`              | Applies a stack of the module: its row's, or one you pick.                                                       |
| Lace: Scan Stack for Drift           | `lace.scanStack`               | Scans a stack of the module for drift: its row's, or one you pick.                                               |
| Lace: Follow Logs                    | `lace.followRunLogs`           | Follows a run's logs in the stack's Output channel. On a run row.                                                |
| Lace: Cancel Run                     | `lace.cancelRun`               | Cancels a run. On a run row.                                                                                     |
| Lace: Open in Portal                 | `lace.openRunInPortal`         | Opens a run's page in the Lace portal. On a run row.                                                             |
| Lace: Open Portal                    | `lace.stacks.openPortal`       | Opens the portal page the Stacks view's failure names. In the view.                                              |
| Lace: Create Stack                   | `lace.stacks.create`           | Creates a stack of the module, asking for its slug and its cloud connection. In the view, while no stack is deployed from the module. |
| Lace: Start Engine                   | `lace.startEngine`             | Starts the Lace engine.                                                                                          |
| Lace: Stop Engine                    | `lace.stopEngine`              | Stops the Lace engine.                                                                                           |
| Lace: Restart Engine                 | `lace.restartEngine`           | Restarts the Lace engine.                                                                                        |
| Lace: Open Logs                      | `lace.openLogs`                | Shows the "Lace" Output channel.                                                                                 |

The module commands act on the module directory chosen as described above. Validate, Convert, Format, Scan and Generate
Docs run on the module's files as the same command typed in a terminal there would, and open no session. Generate,
Format, Convert and Import Existing Resources write the module's `.tf` files, so they save its open `.tf` editors first;
Validate, Scan and Generate Docs read the files as they are on disk, as the chat's validate tool and the canvas's
Validate do, and write nothing.
Lace binds no keys of its own.

## Settings

| Setting            | Default          | What it does                                                                                                 |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `lace.binaryPath`  | `lace` on `PATH` | The Lace CLI the engine runs: `lace` on your `PATH`, or the full path of an executable (`lace.exe` on Windows). Machine-overridable: in a remote window, set it under the **Remote** tab. |
| `lace.autoRestart` | `true`           | Restart the Lace engine when it exits unexpectedly.                                                          |

Lace also reads VS Code's `files.autoSave` and `files.autoSaveDelay` (see above).

## Links

- [Documentation](https://lace.cloud)
- [Report an issue](https://github.com/lace-cloud/vs-code-extension/issues)
- [Source and contributing](https://github.com/lace-cloud/vs-code-extension): building the extension is in its
  `CLAUDE.md` and `AGENTS.md`
