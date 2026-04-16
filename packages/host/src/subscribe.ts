import type { ClientReadableStream } from '@grpc/grpc-js';
import type { EngineEvent } from './generated/service';
import { convertCanvasView } from './transport';
import type { CanvasView, Diagnostic } from './types';

export type SubscribeCallbacks = {
  onStateUpdated: (view: CanvasView) => void;
  onGenerateProgress: (phase: string) => void;
  onGenerateSuccess: (files: string[]) => void;
  onGenerateError: (message: string, diagnostics: Diagnostic[]) => void;
  onEnd: () => void;
  onError: (err: Error) => void;
};

/**
 * Wraps a gRPC server-streaming Subscribe call, dispatching typed
 * EngineEvent fields to callbacks.
 */
export class SubscribeHandler {
  private stream: ClientReadableStream<EngineEvent> | null = null;

  start(stream: ClientReadableStream<EngineEvent>, callbacks: SubscribeCallbacks): void {
    this.stop();
    this.stream = stream;

    stream.on('data', (event: EngineEvent) => {
      if (event.state_updated?.view) {
        callbacks.onStateUpdated(convertCanvasView(event.state_updated.view));
      }

      if (event.generate_progress) {
        callbacks.onGenerateProgress(event.generate_progress.stage);
      }

      if (event.generate_success) {
        callbacks.onGenerateSuccess(event.generate_success.files_written);
      }

      if (event.generate_error) {
        const diagnostics: Diagnostic[] = event.generate_error.diagnostics.map((d) => ({
          severity: severityToString(d.severity),
          message: d.message,
          file: d.file || undefined,
          line: d.line || undefined,
          column: d.column || undefined,
        }));
        callbacks.onGenerateError(event.generate_error.message, diagnostics);
      }
    });

    stream.on('end', () => {
      this.stream = null;
      callbacks.onEnd();
    });

    stream.on('error', (err: Error) => {
      this.stream = null;
      callbacks.onError(err);
    });
  }

  stop(): void {
    if (this.stream) {
      this.stream.cancel();
      this.stream = null;
    }
  }
}

/** Map proto DiagnosticSeverity enum (numeric) to string literal. */
function severityToString(value: number): 'error' | 'warning' | 'info' {
  switch (value) {
    case 1:
      return 'error';
    case 2:
      return 'warning';
    case 3:
      return 'info';
    default:
      return 'error';
  }
}
