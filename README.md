# Lace — Visual Terraform Module Composer

Build Terraform infrastructure visually. Browse a module registry, wire inputs and outputs on a canvas, and generate production-ready `.tf` files — all inside VS Code.

<!-- TODO: Replace with a screenshot or GIF of the Lace canvas in action -->

![Lace Canvas](https://placeholder.com/lace-canvas-screenshot.png)

## Features

- **Visual canvas** — Drag-and-drop module composition with a node-based editor
- **Module registry sidebar** — Browse, search, and inspect modules without leaving VS Code
- **Wire inputs and outputs** — Connect module outputs to other module inputs visually
- **Configure everything** — Variables, outputs, providers, locals, and environments through dedicated config panels
- **Generate Terraform** — Produce production-ready `.tf` files with one click
- **Terraform tooling** — Validate, format, security scan, and generate docs via integrated terminal commands
- **Auto-save** — Optionally auto-save canvas changes as you work

## Getting Started

### Prerequisites

- [VS Code](https://code.visualstudio.com/) 1.96.0 or later
- [Lace CLI](https://lace.cloud) installed and available on your PATH
- Authenticated via `lace login`

### Workflow

1. Open a workspace folder in VS Code
2. Run **Lace: Open Canvas** from the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Browse the **Registry** sidebar (Lace icon in the activity bar) to find modules
4. Click a module to view its details, then **Add to Canvas**
5. Wire module outputs to other module inputs by dragging connections on the canvas
6. Configure variables, providers, and other settings through the config panels
7. Run **Lace: Generate Terraform** to produce `.tf` files

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

Lace connects to a module registry through its CLI backend. When you add modules to the canvas and wire them together, Lace maintains a project file (`lace.json`) that captures your composition. When you generate, Lace produces standard Terraform files (`.tf`) from your visual design.

All project files live in a `.lace/` directory at your workspace root. This directory is meant to be version-controlled alongside the rest of your code.

## Links

- [Documentation](https://lace.cloud)
- [Report an Issue](https://github.com/lace-cloud/vs-code-extension/issues)
- [GitHub Repository](https://github.com/lace-cloud/vs-code-extension)
