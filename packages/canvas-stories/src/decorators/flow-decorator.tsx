import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import { App, ConnectWebEngine } from '@lace/canvas';
import type { HostBridge } from '@lace/canvas';

// Storybook exposes env vars prefixed with STORYBOOK_ to the client bundle via
// Rsbuild's DefinePlugin when declared in `.storybook/main.ts > env`. We read
// them here and fall back to a missing-CLI banner if not set — designers
// iterating on component stories don't need a running CLI.
const ENGINE_URL =
  typeof process !== 'undefined' ? process.env.STORYBOOK_LACE_ENGINE_URL : undefined;
const ENGINE_TOKEN =
  typeof process !== 'undefined' ? process.env.STORYBOOK_LACE_ENGINE_TOKEN : undefined;

// Default session args for flow stories. The CLI's `-tags=test` build ignores
// the path and serves an in-memory session, but a non-empty value is required.
const DEFAULT_FILE_PATH = '/tmp/lace-storybook';
const DEFAULT_WORKSPACE_NAME = 'storybook-flow';
const DEFAULT_OUTPUT_DIR = '/tmp/lace-storybook-out';

/**
 * Story prologue runs after session open; lets each flow story pre-populate
 * the canvas (e.g. place a module, wire nodes, create a group) before the
 * user sees it. Receives the engine; returns a Promise that resolves when
 * setup is complete.
 */
export type FlowPrologue = (engine: ConnectWebEngine) => Promise<void>;

type Status = 'idle' | 'connecting' | 'ready' | 'error';

type FlowDecoratorProps = {
  children?: ReactNode;
  /** Optional setup that runs after sessionOpen and before the story renders. */
  prologue?: FlowPrologue;
};

/**
 * Mounts the full Canvas App wired to a real `lace engine -tags=test`. Requires
 * STORYBOOK_LACE_ENGINE_URL + STORYBOOK_LACE_ENGINE_TOKEN env vars — launch
 * Storybook via `pnpm run dev:storybook-flows` which starts the CLI first.
 */
export function FlowDecorator({ prologue }: FlowDecoratorProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const engine = useMemo<ConnectWebEngine | null>(() => {
    if (!ENGINE_URL || !ENGINE_TOKEN) return null;
    return new ConnectWebEngine({ baseUrl: ENGINE_URL, token: ENGINE_TOKEN });
  }, []);

  // Story-mode HostBridge: no window chrome to manage, so most signals are
  // no-ops. `triggerGenerate` delegates to the engine directly — the Subscribe
  // stream then emits GenerateProgress/Success/Error events through onEvent,
  // which App and useGenerationStatus already consume uniformly.
  const hostBridge = useMemo<HostBridge | null>(() => {
    if (!engine) return null;
    return {
      signalReady: () => {
        // No-op: FlowDecorator already owns session lifecycle below.
      },
      markDirty: () => {
        // No window title to decorate in Storybook.
      },
      markClean: () => {
        // No window title to decorate in Storybook.
      },
      triggerGenerate: () => {
        void engine
          .sessionGenerate(DEFAULT_OUTPUT_DIR, {
            format: true,
            validate: true,
            overwrite: true,
          })
          .catch((err) => {
            // Errors surface to App via the Subscribe stream's GenerateError
            // event; log here so dev console also shows it if the stream
            // hasn't opened yet (e.g. immediate network failure).
            console.error('[FlowDecorator] sessionGenerate failed:', err);
          });
      },
      openFile: () => {
        // No editor to open in Storybook.
      },
    };
  }, [engine]);

  // Open session + run prologue + start Subscribe stream.
  useEffect(() => {
    if (!engine) return;
    let cancelled = false;
    let stopSubscribe: (() => void) | null = null;

    async function boot() {
      if (!engine) return;
      setStatus('connecting');
      try {
        await engine.sessionOpen(DEFAULT_FILE_PATH, DEFAULT_WORKSPACE_NAME);
        if (cancelled) return;
        // Start streaming BEFORE prologue so its mutation-driven state
        // updates reach App via the Subscribe StateUpdated events.
        stopSubscribe = engine.startSubscribe();
        if (prologue) await prologue(engine);
        if (cancelled) return;
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    }

    void boot();
    return () => {
      cancelled = true;
      stopSubscribe?.();
      engine.sessionClose().catch(() => {
        /* best-effort cleanup on unmount */
      });
    };
  }, [engine, prologue]);

  if (!engine || !hostBridge) {
    return <CliMissingBanner />;
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      {status === 'error' && errorMessage ? <ConnectionErrorBanner message={errorMessage} /> : null}
      <App engine={engine} hostBridge={hostBridge} />
    </div>
  );
}

function CliMissingBanner() {
  return (
    <div
      style={{
        padding: 24,
        maxWidth: 600,
        color: '#f4f4f4',
        background: '#262626',
        border: '1px solid #525252',
        borderRadius: 6,
        fontFamily: 'system-ui, sans-serif',
        lineHeight: 1.5,
      }}
    >
      <h2 style={{ marginTop: 0, color: '#ffd7d7' }}>CLI not running</h2>
      <p>Flow stories need a live Lace engine. Launch Storybook with the CLI attached:</p>
      <pre
        style={{
          background: '#161616',
          padding: 12,
          borderRadius: 4,
          overflowX: 'auto',
        }}
      >
        pnpm run dev:storybook-flows
      </pre>
      <p style={{ fontSize: 13, color: '#a8a8a8' }}>
        This sets <code>STORYBOOK_LACE_ENGINE_URL</code> and{' '}
        <code>STORYBOOK_LACE_ENGINE_TOKEN</code> from the CLI handshake. Component stories (no CLI
        required) work either way.
      </p>
    </div>
  );
}

function ConnectionErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        right: 16,
        padding: 12,
        background: '#4a1515',
        color: '#ffd7d7',
        border: '1px solid #a2191f',
        borderRadius: 4,
        fontFamily: 'system-ui, sans-serif',
        zIndex: 1000,
      }}
    >
      <strong>Engine error:</strong> {message}
    </div>
  );
}
