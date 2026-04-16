import * as vscode from 'vscode';
import type { LaceTransport, EngineEvent } from '@lace/host';
import { convertCanvasView } from '@lace/host';
import type { ProactiveSuggestion } from '../protocol';
import {
  matchAll,
  advanceState,
  initialRuleState,
  type RuleState,
  type EngineEventLike,
} from './proactivity/rules';

const RETRY_DELAY_MS = 1000;

/**
 * Consumes the engine's Subscribe stream, matches rule-based proactive
 * suggestions, and posts them to the webview.
 *
 * Gated by `lace.chatProactivity` config (off | on). Re-checks the config
 * on every event.
 */
export class ProactivityWatcher {
  private stream: ReturnType<LaceTransport['subscribeStream']> | null = null;
  private ruleState: RuleState = initialRuleState();
  private retried = false;
  private stopped = false;

  constructor(
    private readonly transport: LaceTransport,
    private readonly sessionId: string,
    private readonly onSuggestion: (s: ProactiveSuggestion) => void,
    private readonly log: (msg: string) => void,
  ) {}

  start(): void {
    if (this.stopped) return;
    this.stream = this.transport.subscribeStream(this.sessionId);

    this.stream.on('data', (event: EngineEvent) => this.handleEvent(event));
    this.stream.on('end', () => {
      this.log('[Proactivity] stream ended');
      this.stream = null;
    });
    this.stream.on('error', (err: Error) => {
      this.log(`[Proactivity] stream error: ${err.message}`);
      this.stream = null;
      if (!this.retried && !this.stopped) {
        this.retried = true;
        setTimeout(() => {
          if (!this.stopped) this.start();
        }, RETRY_DELAY_MS);
      }
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.stream) {
      this.stream.cancel();
      this.stream = null;
    }
  }

  private handleEvent(event: EngineEvent): void {
    // Convert the raw proto event into the render-model shape the rules expect.
    // Rules are pure and environment-neutral; they don't touch proto types.
    const converted = toEngineEventLike(event);

    const enabled =
      vscode.workspace.getConfiguration('lace').get<string>('chatProactivity', 'on') === 'on';
    if (!enabled) {
      // Still advance state so we don't miss transitions when re-enabled mid-session.
      this.ruleState = advanceState(converted, this.ruleState);
      return;
    }

    const suggestion = matchAll(converted, this.ruleState);
    this.ruleState = advanceState(converted, this.ruleState);
    if (suggestion) this.onSuggestion(suggestion);
  }
}

function toEngineEventLike(event: EngineEvent): EngineEventLike {
  const result: EngineEventLike = {};
  if (event.state_updated?.view) {
    result.state_updated = { view: convertCanvasView(event.state_updated.view) };
  }
  if (event.generate_progress) {
    result.generate_progress = {
      stage: event.generate_progress.stage,
      message: event.generate_progress.message,
    };
  }
  if (event.generate_success) {
    result.generate_success = {
      files_written: event.generate_success.files_written,
      files: event.generate_success.files,
    };
  }
  if (event.generate_error) {
    result.generate_error = {
      message: event.generate_error.message,
      diagnostics: event.generate_error.diagnostics.map((d) => ({
        message: d.message,
      })),
    };
  }
  return result;
}
