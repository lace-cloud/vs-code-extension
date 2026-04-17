#!/usr/bin/env node
/**
 * Captures render-model `CanvasView` fixtures from a live `lace engine`
 * (built with `-tags=test`) by driving the Connect-JSON endpoint the same
 * way ConnectWebEngine does. Output lands as TS files in
 * packages/canvas-stories/src/mocks/fixtures/, consumed by the
 * MockCanvasEngine used in Flows/Mock/* stories.
 *
 * Regen when lace-cli changes a seed: `pnpm run capture-fixtures`.
 *
 * Usage: pnpm run capture-fixtures
 * Env:   LACE_BIN (default: `lace`) — override to point at a non-PATH binary.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LACE_BIN = process.env.LACE_BIN ?? 'lace';
const FIXTURES = ['empty', 'iam-role', 'wired-stack', 'iam-stack', 'collapsed-group'];
const HANDSHAKE_TIMEOUT_MS = 10_000;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../packages/canvas-stories/src/mocks/fixtures');

// ── Handshake parser (mirrors packages/host/src/engine-process.ts) ──

function parseHandshake(buf) {
  const lines = buf.toString('utf-8').split('\n');
  const get = (key) => {
    const line = lines.find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1) : null;
  };
  const port = get('LACE_ENGINE_PORT');
  const token = get('LACE_ENGINE_TOKEN');
  const ready = lines.includes('LACE_ENGINE_READY');
  return port && token && ready ? { port, token } : null;
}

function spawnEngine() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(LACE_BIN, ['engine'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Handshake timeout after ${HANDSHAKE_TIMEOUT_MS}ms`));
    }, HANDSHAKE_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const hs = parseHandshake(buf);
      if (hs) {
        clearTimeout(timer);
        resolvePromise({ child, ...hs });
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) reject(new Error(`Engine exited with code ${code}`));
    });
  });
}

// ── Proto JSON → render POJO ──

const NODE_KIND = {
  NODE_KIND_MODULE: 'module',
  NODE_KIND_RESOURCE: 'resource',
  NODE_KIND_DATA: 'data',
};

function convertPin(p) {
  if (!p) return p;
  const pin = {
    name: p.name ?? '',
    type: p.type ?? 'any',
  };
  if (p.typeFamily !== undefined) pin.type_family = p.typeFamily;
  if (p.required !== undefined) pin.required = p.required;
  if (p.wired !== undefined) pin.wired = p.wired;
  if (p.description !== undefined) pin.description = p.description;
  if (p.sensitive !== undefined) pin.sensitive = p.sensitive;
  return pin;
}

function convertNode(n) {
  const node = {
    id: n.id ?? '',
    label: n.label ?? '',
    kind: NODE_KIND[n.kind] ?? 'module',
    position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    has_errors: n.hasErrors ?? false,
    error_messages: n.errorMessages ?? [],
    inputs: (n.inputs ?? []).map(convertPin),
    outputs: (n.outputs ?? []).map(convertPin),
  };
  if (n.moduleKey !== undefined) node.module_key = n.moduleKey;
  if (n.iconUrl !== undefined) node.icon_url = n.iconUrl;
  return node;
}

function convertEdge(e) {
  return {
    id: e.id ?? '',
    source: e.source ?? '',
    target: e.target ?? '',
    source_output: e.sourceOutput ?? '',
    target_input: e.targetInput ?? '',
  };
}

function convertError(e) {
  const err = { message: e.message ?? '' };
  if (e.instanceId !== undefined) err.instance_id = e.instanceId;
  if (e.inputName !== undefined) err.input_name = e.inputName;
  return err;
}

function convertGroup(g) {
  const group = {
    id: g.id ?? '',
    label: g.label ?? '',
    node_ids: g.nodeIds ?? [],
    collapsed: g.collapsed ?? false,
  };
  if (g.moduleKey !== undefined) group.module_key = g.moduleKey;
  if (g.inputs) group.inputs = g.inputs.map(convertPin);
  if (g.outputs) group.outputs = g.outputs.map(convertPin);
  return group;
}

function convertCanvasView(proto) {
  return {
    module_name: proto.moduleName ?? '',
    nodes: (proto.nodes ?? []).map(convertNode),
    edges: (proto.edges ?? []).map(convertEdge),
    errors: (proto.errors ?? []).map(convertError),
    can_undo: proto.canUndo ?? false,
    can_redo: proto.canRedo ?? false,
    is_dirty: proto.isDirty ?? false,
    groups: (proto.groups ?? []).map(convertGroup),
  };
}

// ── Driver ──

async function call(port, token, method, body) {
  const res = await fetch(`http://127.0.0.1:${port}/lace.engine.LaceEngine/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} failed: HTTP ${res.status} — ${text}`);
  }
  return res.json();
}

function toCamelCase(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

async function main() {
  mkdirSync(outDir, { recursive: true });

  console.log(`→ Spawning ${LACE_BIN} engine…`);
  const { child, port, token } = await spawnEngine();
  console.log(`  ready on 127.0.0.1:${port}`);

  try {
    for (const fixture of FIXTURES) {
      console.log(`→ TestSessionOpen "${fixture}"`);
      const res = await call(port, token, 'TestSessionOpen', { fixture_name: fixture });
      const view = convertCanvasView(res.view ?? {});
      const constName = `${toCamelCase(fixture)}Fixture`;
      const ts = [
        '// Captured from `lace engine -tags=test` via scripts/capture-fixtures.mjs.',
        '// Regenerate with: pnpm run capture-fixtures',
        "import type { CanvasView } from '@lace/proto';",
        '',
        `export const ${constName}: CanvasView = ${JSON.stringify(view, null, 2)};`,
        '',
      ].join('\n');
      writeFileSync(resolve(outDir, `${fixture}.ts`), ts);
      await call(port, token, 'SessionClose', { session_id: res.sessionId });
    }

    // Index barrel for convenient imports. Sorted so biome's
    // organizeImports assist doesn't flag the generated output.
    const barrel = [
      '// Auto-generated by scripts/capture-fixtures.mjs — do not edit by hand.',
      ...[...FIXTURES].sort().map((f) => `export { ${toCamelCase(f)}Fixture } from './${f}';`),
      '',
    ].join('\n');
    writeFileSync(resolve(outDir, 'index.ts'), barrel);

    console.log(`✓ Wrote ${FIXTURES.length} fixtures to ${outDir}`);
  } finally {
    child.kill();
    await new Promise((r) => child.on('exit', r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
