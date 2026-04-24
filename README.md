# Lace — Visual Terraform Module Composer

Build Terraform infrastructure visually. Browse a module registry, wire inputs and outputs on a canvas, and generate production-ready `.tf` files — all inside VS Code.

## Features

- **Visual canvas** — Drag-and-drop module composition with a node-based editor
- **Module registry sidebar** — Browse, search, and inspect modules without leaving VS Code
- **Wire inputs and outputs** — Connect module outputs to other module inputs visually
- **`@lace` chat participant** — Compose infrastructure using natural language in VS Code Chat (e.g. `@lace add an AWS VPC and connect it to a subnet`)
- **Configure everything** — Variables, outputs, providers, locals, and environments through dedicated config panels
- **Generate Terraform** — Produce production-ready `.tf` files with one click
- **Terraform tooling** — Validate, format, security scan, and generate docs via integrated terminal commands
- **Auto-save** — Optionally auto-save canvas changes as you work

## Getting Started

### Prerequisites

- [VS Code](https://code.visualstudio.com/) 1.96.0 or later
- [Lace CLI](https://lace.cloud) installed and available on your PATH
- Authenticated via `lace login`

### Quick Start

1. Open a workspace folder in VS Code
2. Run **Lace: Open Canvas** from the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Browse the **Registry** sidebar (Lace icon in the activity bar) to find modules
4. Click a module to view its details, then **Add to Canvas**
5. Wire module outputs to other module inputs by dragging connections on the canvas
6. Configure variables, providers, and other settings through the config panels
7. Run **Lace: Generate Terraform** to produce `.tf` files

### Using `@lace` in VS Code Chat

Open the Chat panel and mention `@lace` to compose infrastructure with natural language:

```
@lace add an AWS VPC and a public subnet, then connect them
@lace describe the current canvas
@lace suggest infrastructure for my project
@lace generate terraform files
```

Slash commands are also available:

| Command     | Description                             |
| ----------- | --------------------------------------- |
| `/add`      | Add a module to the canvas              |
| `/connect`  | Connect two modules                     |
| `/describe` | Describe the current canvas state       |
| `/suggest`  | Suggest infrastructure for your project |
| `/generate` | Generate Terraform files                |
| `/validate` | Validate the current graph              |

## Commands

| Command                         | Description                                           |
| ------------------------------- | ----------------------------------------------------- |
| `Lace: Open Canvas`             | Open the visual canvas for the current workspace      |
| `Lace: Add Module to Canvas`    | Quick-pick a module and add it directly to the canvas |
| `Lace: Generate Terraform`      | Validate the canvas and generate `.tf` files          |
| `Lace: Terraform Validate`      | Run `terraform validate` on generated files           |
| `Lace: Terraform Format`        | Run `terraform fmt` on generated files                |
| `Lace: Terraform Security Scan` | Run a security scan on generated files                |
| `Lace: Terraform Docs`          | Generate documentation for your Terraform config      |
| `Lace: Start Engine`            | Start the Lace CLI backend process                    |
| `Lace: Stop Engine`             | Stop the Lace CLI backend process                     |
| `Lace: Restart Engine`          | Restart the Lace CLI backend process                  |

## Settings

| Setting            | Default               | Description                                                            |
| ------------------ | --------------------- | ---------------------------------------------------------------------- |
| `lace.binaryPath`  | `/usr/local/bin/lace` | Path to the Lace CLI binary                                            |
| `lace.autoStart`   | `true`                | Start the CLI engine automatically when the extension activates        |
| `lace.autoRestart` | `true`                | Automatically restart the engine on crash (up to 3 retries)            |
| `lace.autoSave`    | `false`               | Automatically save canvas changes. When disabled, use `Cmd+S` to save. |

## How It Works

Lace connects to a module registry through its CLI backend. When you add modules to the canvas and wire them together, Lace maintains a project file (`.lace/.canvas/state.lace`) that captures your composition. When you generate, Lace produces standard Terraform files (`.tf`) from your visual design.

All project files live in a `.lace/` directory at your workspace root. This directory is meant to be version-controlled alongside the rest of your code.

## Developing

This repo is a thin VS Code adapter shell. The library code (`@lace-cloud/canvas`,
`@lace-cloud/host`, `@lace-cloud/chat-core`, `@lace-cloud/chat-webview`,
`@lace-cloud/ui`, `@lace-cloud/design-tokens`, `@lace-cloud/proto`) lives in
[`lace-cloud/lace`](https://github.com/lace-cloud/lace) and is published
to GitHub Packages.

### Local setup

The `@lace-cloud/*` packages are public, but `npm.pkg.github.com` requires *some*
GitHub token to download (a GitHub-side quirk, not a permissions issue). Any
classic PAT with `read:packages` works:

```bash
# 1. Create a classic PAT with read:packages scope:
#    https://github.com/settings/tokens/new?scopes=read:packages
# 2. Export it (add to your shell rc to persist):
export NODE_AUTH_TOKEN=<your-pat>
# 3. Install:
pnpm install
```

CI uses the workflow's `GITHUB_TOKEN` automatically — no setup needed.

### Build & test

```bash
pnpm build              # rspack: extension.js + webview.js + chat-sidebar.js
pnpm test:unit          # vitest (chat-sidebar tests)
pnpm test:host-e2e      # @vscode/test-electron smoke + command tests
pnpm lint               # biome check
npx tsc --noEmit        # typecheck
```

### Layout

```
src/                    — extension activation, canvas + chat webview entries, vscode-coupled host primitives
packages/chat-sidebar/  — VS Code chat adapter (ChatViewProvider, vscode-adapter, controller)
packages/host-e2e/      — VS Code integration tests
.github/                — CI (lint + unit + host-e2e), pre-release + release-guard + release workflows
```

For `lace` development (the libraries themselves), see
[`lace-cloud/lace`](https://github.com/lace-cloud/lace).

## Links

- [Documentation](https://lace.cloud)
- [Report an Issue](https://github.com/lace-cloud/vs-code-extension/issues)
- [GitHub Repository](https://github.com/lace-cloud/vs-code-extension)
