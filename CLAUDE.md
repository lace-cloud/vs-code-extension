# Lace VS Code extension

The extension is the full VS Code host of Lace's module-authoring canvas. It hosts the canvas of `@lace-cloud/canvas` as
the authoring UI for Terraform modules and supplies every port the canvas package defines; around it, it draws its own
surfaces over the same data: the registry sidebar and module detail, a native Stacks tree, palette commands, diagnostics
in the Problems panel, sign-in with organization and team, and the chat tools in VS Code's own chat. Capability comes
from the Lace engine and the `lace` CLI; the extension draws it and decides nothing the engine or the CLI owns.

A module is authored at three levels: the `.tf` files in the text editor, the canvas, and the developer's coding
assistant in VS Code's chat through Lace's tools. Switching between them at any moment is the design's north star, and
every level works on one authoring session per module directory.

`AGENTS.md` holds the architecture, the rules each module follows, the protocols, the tools and the tests. Read it before
changing code. `README.md` is the Marketplace page: what a developer installing the extension sees.

## Words

The code and the docs use Lace's own vocabulary:

- **authoring root**: the directory a module is authored in, any directory under a workspace folder that holds a `.tf`
  file (`root` in code). Not the workspace folder.
- **authoring session**: the engine's session of one authoring root, where "session" could be read as a chat session.
- **diagnostic**: what the engine, Validate, Convert and Scan report about the Terraform. Not "finding".
- **the developer's coding assistant** (or "the developer's model"): the model a developer already uses in chat, the one
  model the chat tools run in. Not "agent"; VS Code's own names ("agent mode") stay VS Code's.
- The canvas **shows the edit**; "preview" is the stack command.
- Public text describes the canvas tools' resolution by what it does: "how Lace's canvas tools resolve what you ask
  for".

## Layout

```
src/
  extension.ts            activation: the engine, the root sessions, autosave, then every feature; deactivate
  features.ts             the window's shared owners (windowHost) and the list of features activation registers
  engine/                 the engine, the root sessions, the commands mapping, the runner host, a command's outcome
  roots/                  authoring roots: which module directory a surface acts on, and how one is chosen
  canvas/                 the canvas panels (one webview panel per root) and Lace: Open Canvas
  canvas-webview/         the canvas page (browser bundle)
  registry/               the registry sidebar, module detail, placement, Add Module to Canvas (host side)
  registry-webview/       the registry sidebar and module detail pages (browser bundles)
  stacks/                 the Stacks tree, its rows, the runs' Output channels
  commands/               the module commands of the palette; Save and Generate's one rule each
  account/                sign-in and sign-out; organization and team
  diagnostics/            the Problems panel
  state/                  what the window keeps per root: the picked stack, the canvas arrangement
  autosave/               when a canvas saves, from files.autoSave
  tools/                  the chat tools as Language Model Tools
  protocol/               the webview ↔ host protocols, shared by both bundles
  vscode/                 command registration, dialogs, notices with their offers, webview HTML, a terminal's command line
  webview/                the page side of a webview's postMessage pair
resources/instructions/   the text-level instructions contributed to the developer's coding assistant
packages/host-e2e/        the window e2e (a real VS Code against a real engine)
LACE_CLI_VERSION          the released `lace` CLI the engine tests and the window e2e run
```

Rspack builds four bundles into `out/`: `extension.js` (Node, from `src/extension.ts`; it imports the React-free
`@lace-cloud/canvas/engine` and never the canvas barrel) and the browser pages `canvas-webview.js`,
`registry-sidebar.js` and `module-detail.js`, each with its stylesheet.

## The libraries and the engine

The extension depends on Lace's `@lace-cloud/*` packages from npm, at the versions `package.json` pins (all at one
version: the packages are released together), and on the `lace` CLI as its engine. The engine the tests run is the
released CLI at the version `LACE_CLI_VERSION` names, found in `bin/` (ignored) or on `PATH`; a binary that says
another version, any other build of the CLI included, is refused. `src/__tests__/tracked-pins.test.ts` holds what git
tracks to published versions: no local path, link or override in a manifest, the workspace file or the lockfile, and a
lockfile that locks exactly what the manifests name.

## Build and test

```bash
pnpm run lint          # biome check
pnpm run typecheck     # tsc over tsconfig.json (host side), tsconfig.webview.json (pages), packages/host-e2e
pnpm run test:unit     # vitest project `unit`: no build, no engine
pnpm run build         # rspack: the four bundles in out/
pnpm run test:build    # vitest project `build`: the bundles in out/ (run pnpm build first)
pnpm run test:engine   # vitest project `engine`: the `lace` CLI of LACE_CLI_VERSION, in bin/ or on PATH
pnpm run manifest:tools  # writes package.json's languageModelTools entries from the tool sets' schemas
```

The three vitest projects are told apart by file name: `*.test.ts(x)` is `unit`, `*.build.test.ts` is `build`,
`*.engine.test.ts` is `engine`. Every engine test builds on `src/engine/__tests__/real-engine.ts`, the one helper that
starts the engine as one window has it, in a git repository and a developer home of the test's own (`signedOutHome()`
leaves the developer signed out with no saved selection). The engine is `bin/lace` when one is there, else the `lace` on
`PATH`, at the version `LACE_CLI_VERSION` names (`src/engine/__tests__/engine-binary.mjs`, which the window e2e reads
too). To run the extension, press F5 (**Run Extension**); `lace.binaryPath` names the CLI, `/usr/local/bin/lace` by
default.

### End-to-end tests

```bash
pnpm --filter @lace-cloud/host-e2e test     # the window e2e (run pnpm build first)
```

**The window e2e** (`packages/host-e2e/window/`) loads the built extension into a real VS Code that `@vscode/test-cli`
downloads, in a fresh git repository whose settings name the engine, and runs signed out. It opens a VS Code window for
a few seconds; CI runs it under a virtual display. Nothing in the tests signs in.

## Branch flow and shipping

- **Feature branches** branch off `develop` and open a PR to `develop`. `ci.yml` installs the dependencies from npm and
  the `lace` CLI that `LACE_CLI_VERSION` names (the CLI's published installer, which verifies the release), then runs
  lint, typecheck, the unit tests, the build and the bundle tests, then the engine tests and the window e2e under a
  virtual display. `ci-summary` is `develop`'s one required status check; direct pushes to `develop` are blocked.
- **Every push to `develop` that touches extension source publishes a Marketplace pre-release** (`pre-release.yml`).
  Nothing is pushed to `develop` without the owner's word.
- **`main`** accepts PRs only from `develop`. `release-guard.yml` requires the `package.json` version to have moved
  against `main`. A push to `main` runs `release.yml`: build, package, tag `vX.Y.Z`, `vsce publish`, and a GitHub
  Release with the `.vsix` attached.
- **Versions** follow VS Code's pre-release convention: stable uses even minors (`0.4.0`, `0.4.1`; bump a minor with
  `pnpm version <MAJOR>.<MINOR+2>.0 --no-git-tag-version`, a patch with `pnpm version patch`), and a pre-release is
  `<major>.<stable minor + 1>.<github.run_number>`, stamped by the workflow and never committed.
- **A new release of the libraries**: the `@lace-cloud/*` pins and `pnpm-lock.yaml` move to it, all at once (the
  packages are released together). **A new release of the CLI**: `LACE_CLI_VERSION` moves to it.

## How to work on this codebase

- **Read the code and `AGENTS.md` before proposing.** Every module opens with a comment saying what it owns; keep that
  comment true.
- **Fix at the source.** A gap in the engine, the CLI or a library is fixed there, in Lace, never worked around here: no
  host-side rule beside a library's, no special case, no flag, no "for now".
- **One owner per decision.** Before adding state or a rule, find the module that owns it (`AGENTS.md`, "Who owns
  what") and use it.
- **Capability is a port's presence**, never a flag; a pure function does not branch on an empty value.
- **Reasons are data.** Branch on a failure's `reason`, never on its message text.
- **Never make a test pass by weakening it.** A test that fails says the code is wrong, unless the test is stale for a
  deliberate change, and then say so.
- **Docs describe the system as it is**: no history, no "new in", no plans.
