// Engine-stream proactivity watcher.
//
// Subscribes to the engine event stream and applies pure rule
// functions (see `./rules`) to propose between-turn suggestions. The
// only configurable surface is whether suggestions are emitted; even
// when disabled we still advance internal state so transitions
// aren't lost if the setting flips back on mid-session.
//
// All IDE-specific concerns (reading config, writing to the chat
// webview) are reached through the `ChatHostAdapter` and a user-
// supplied callback — nothing in this file imports vscode or any
// other editor API.

import type { EngineEvent, LaceTransport } from '@lace/host';
import { convertCanvasView } from '@lace/host';
import type { ChatHostAdapter } from '../host-adapter';
import type { ProactiveSuggestion } from '../protocol';
import {
  advanceState,
  type EngineEventLike,
  initialRuleState,
  matchAll,
  type RuleState,
} from './rules';

const RETRY_DELAY_MS = 1000;
const CONFIG_KEY = 'proactivity';
const CONFIG_ENABLED_VALUE = 'on';

export type ProactivityWatcherOptions = {
  transport: LaceTransport;
  sessionId: string;
  adapter: Pick<ChatHostAdapter, 'getConfig' | 'log'>;
  onSuggestion: (suggestion: ProactiveSuggestion) => void;
};

export class ProactivityWatcher {
  private stream: ReturnType<LaceTransport['subscribeStream']> | null = null;
  private ruleState: RuleState = initialRuleState();
  private retried = false;
  private stopped = false;

  constructor(private readonly opts: ProactivityWatcherOptions) {}

  start(): void {
    if (this.stopped) return;
    this.stream = this.opts.transport.subscribeStream(this.opts.sessionId);

    this.stream.on('data', (event: EngineEvent) => this.handleEvent(event));
    this.stream.on('end', () => {
      this.opts.adapter.log('[Proactivity] stream ended');
      this.stream = null;
    });
    this.stream.on('error', (err: Error) => {
      this.opts.adapter.log(`[Proactivity] stream error: ${err.message}`);
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
    this.stream?.cancel();
    this.stream = null;
  }

  private handleEvent(event: EngineEvent): void {
    const converted = toEngineEventLike(event);
    const enabled =
      this.opts.adapter.getConfig(CONFIG_KEY, CONFIG_ENABLED_VALUE) === CONFIG_ENABLED_VALUE;

    if (enabled) {
      const suggestion = matchAll(converted, this.ruleState);
      if (suggestion) this.opts.onSuggestion(suggestion);
    }
    this.ruleState = advanceState(converted, this.ruleState);
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
      diagnostics: event.generate_error.diagnostics.map((d) => ({ message: d.message })),
    };
  }
  return result;
}

export * from './rules';
