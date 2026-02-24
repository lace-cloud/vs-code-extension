---
name: lace-host
description: >
  VS Code extension host and RPC patterns for Lace. Use when working on
  extension.ts, createWebviewPanel.ts, ModuleDetailPanel.ts,
  getWebviewContent.ts, RegistrySidebarProvider.ts, or any file in
  utilities/engine/. Also activate for commands, keybindings, status bar,
  or anything involving the vscode module.
---

## Environment Constraint

This code runs in Node.js (VS Code extension host). NEVER import:

- React, ReactDOM, or any browser API (`document`, `window`, `fetch`)
- `@xyflow/react` or any webview-side rendering module
- Any file from `src/webview/components/` or `src/webview/Canvas.tsx`

You MAY import from shared boundaries:

- `src/types/protocol.ts` — message unions
- `src/webview/types/ir.ts` — wire format types (read-only reference)
- `src/webview/utils/bundle.ts` — `fromBundle`/`toBundle` for host-side validation

## RPC Communication

The extension talks to a Go CLI binary (`lace`) over JSON-RPC 2.0 on
stdin/stdout, managed by `ServerManager` and `JSONRPCClient`.

### Client Usage Pattern

```typescript
const client = requireClient(server?.rpcClient, 'operation name');
const result = await client.someMethod(params);
```

- Always use `requireClient()` before any RPC call — it throws a user-friendly
  error if the engine isn't running.
- Handle errors via `handleRpcError(err, method, operation)`.
- Never swallow RPC errors silently.

### Available RPC Methods

- `initialize(clientVersion)` — handshake
- `listRegistryModules(params)` — paginated module listing
- `getRegistryVersion(params)` — fetch deploy_bundle for a specific version
- `getRegistryModule(params)` — module metadata with all versions
- `validate({ bundle })` — Terraform validation, returns diagnostics
- `generate({ bundle, outputDir })` — write .tf files
- `shutdown()` — clean exit

## Webview Communication

**Sending to webview:**

```typescript
function postToWebview(panel: vscode.WebviewPanel, msg: HostToWebview) {
  panel.webview.postMessage(msg);
}
```

**Receiving from webview:** Via `panel.webview.onDidReceiveMessage(handler)`
dispatching on `msg.command`.

All message types are discriminated unions in `src/types/protocol.ts`.

## Pre-Generate Validation Flow

In `createWebviewPanel.ts`, the `generateBundle` handler runs three steps
in order. Do not skip or reorder:

1. **Graph validation** — `fromBundle(bundle)` + `validateWorkspace()`.
   If errors → send `validationErrors` + `generateError`, abort.
2. **Terraform validation** — RPC `validate({ bundle })`. Filter for
   `severity === 'error'`. If errors → `generateError` with diagnostics.
   If RPC unavailable (older CLI) → log warning, proceed.
3. **Generate** — Clear validation errors, RPC `generate({ bundle, outputDir })`.

## Persistence

- All state in `.lace/lace.json` at workspace root
- Generated `.tf` files in the `.lace/` directory
- No global storage, no Store class, no database
- `getLaceDir()` resolves the path from `vscode.workspace.workspaceFolders`

## Registry Sidebar

`RegistrySidebarProvider` is a `WebviewViewProvider` that renders HTML
directly (not React). It owns all registry data, fetches via RPC, and
paginates with `fetchAllModules()`. The webview never fetches registry data —
module drops arrive as `dropBundle` messages from the host.

## Extension Lifecycle

- `activate()` registers all commands, starts the engine (if autoStart),
  sets up the registry sidebar and status bar
- `deactivate()` disposes the server
- `ServerManager` emits `state` events: `stopped`, `starting`, `running`, `error`
- Terraform commands (`validate`, `fmt`, `scan`, `docs`) shell out to the
  CLI via `vscode.window.createTerminal()`
