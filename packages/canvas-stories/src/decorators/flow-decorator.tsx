import type { HostBridge } from '@lace/canvas';
import { App, ConnectWebEngine } from '@lace/canvas';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

// Storybook exposes env vars prefixed with STORYBOOK_ to the client bundle
// via Rsbuild's DefinePlugin (see .storybook/main.ts > env). The values
// are substituted at build time, so at runtime these reads are literal
// strings or undefined — no `process` shim needed.
const ENGINE_URL = process.env.STORYBOOK_LACE_ENGINE_URL;
const ENGINE_TOKEN = process.env.STORYBOOK_LACE_ENGINE_TOKEN;

// Each flow story gets an ephemeral (memory-only) session so concurrent
// stories don't share state — backed sessions are keyed by file path and
// would be reused across stories. Generate-output paths are per-session too.
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
  /**
   * When set, boot via `engine.testSessionOpen(fixtureName)` which loads a
   * deterministic embedded seed from the CLI's `-tags=test` build. Preferred
   * for golden-path tests — no registry, no network. Falls back to an
   * ephemeral session + prologue when omitted.
   */
  fixtureName?: string;
  /**
   * Optional setup that runs after session open and before the story
   * renders. Ignored when `fixtureName` is set (fixtures are supposed to
   * be complete on their own).
   */
  prologue?: FlowPrologue;
};

/**
 * Mounts the full Canvas App wired to a real `lace engine -tags=test`. Requires
 * STORYBOOK_LACE_ENGINE_URL + STORYBOOK_LACE_ENGINE_TOKEN env vars — launch
 * Storybook via `pnpm run dev:storybook-flows` which starts the CLI first.
 */
export function FlowDecorator({ fixtureName, prologue }: FlowDecoratorProps) {
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
            // Immediate network / transport errors don't reach the
            // Subscribe stream's GenerateError event, so surface them
            // via the same banner the boot path uses. Downstream
            // GenerateError events still replace the banner with
            // their own (richer) message.
            setErrorMessage(err instanceof Error ? err.message : String(err));
            setStatus('error');
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
        if (fixtureName) {
          await engine.testSessionOpen(fixtureName);
        } else {
          await engine.openEphemeralSession(DEFAULT_WORKSPACE_NAME);
        }
        if (cancelled) return;
        // Start streaming BEFORE prologue so its mutation-driven state
        // updates reach App via the Subscribe StateUpdated events.
        stopSubscribe = engine.startSubscribe();
        if (!fixtureName && prologue) await prologue(engine);
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
      // Cleanup on unmount is best-effort: the React tree is gone,
      // there's no state to update on failure. Surface the error to
      // dev console so it shows up in CI logs if the engine hangs
      // at close time.
      engine.sessionClose().catch((err) => {
        console.error('[FlowDecorator] sessionClose on unmount failed:', err);
      });
    };
  }, [engine, fixtureName, prologue]);

  if (!engine || !hostBridge) {
    return <CliMissingBanner />;
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      {status === 'error' && errorMessage ? <ConnectionErrorBanner message={errorMessage} /> : null}
      <App engine={engine} hostBridge={hostBridge} />
      {/*
        Readiness marker for Playwright. Invisible to the user; selectable
        via [data-flow-ready] once boot (sessionOpen + subscribe + any
        prologue) has completed. Tests wait for this before screenshotting.
      */}
      {status === 'ready' ? <div hidden data-flow-ready="" /> : null}
    </div>
  );
}

function CliMissingBanner() {
  return (
    <div
      style={{
        padding: 'var(--lace-space-5)',
        maxWidth: 600,
        color: 'var(--lace-color-text-primary)',
        background: 'var(--lace-color-bg-surface-alt)',
        border: '1px solid var(--lace-color-border-subtle)',
        borderRadius: 'var(--lace-radius-md)',
        fontFamily: 'var(--lace-font-sans)',
        lineHeight: 'var(--lace-line-height-normal)',
      }}
    >
      <h2 style={{ marginTop: 0, color: 'var(--lace-color-text-danger-soft)' }}>CLI not running</h2>
      <p>Flow stories need a live Lace engine. Launch Storybook with the CLI attached:</p>
      <pre
        style={{
          background: 'var(--lace-color-bg-canvas)',
          padding: 'var(--lace-space-3)',
          borderRadius: 'var(--lace-radius-sm)',
          overflowX: 'auto',
        }}
      >
        pnpm run dev:storybook-flows
      </pre>
      <p style={{ fontSize: 'var(--lace-font-size-lg)', color: 'var(--lace-color-text-muted)' }}>
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
        top: 'var(--lace-space-4)',
        left: 'var(--lace-space-4)',
        right: 'var(--lace-space-4)',
        padding: 'var(--lace-space-3)',
        background: 'var(--lace-toast-error-bg)',
        color: 'var(--lace-color-text-danger-soft)',
        border: '1px solid var(--lace-color-text-danger)',
        borderRadius: 'var(--lace-radius-sm)',
        fontFamily: 'var(--lace-font-sans)',
        zIndex: 'var(--lace-z-tooltip)',
      }}
    >
      <strong>Engine error:</strong> {message}
    </div>
  );
}
