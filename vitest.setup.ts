// Vitest setup — runs once before any test file.
//
// Provides a default `vscode` module mock so any test that
// transitively loads a vscode-dependent module (via @lace/host,
// @lace/chat-core's proactivity, etc.) doesn't explode on the
// unresolvable `import * as vscode from 'vscode'`. Tests that
// exercise vscode surface area (history-codec, adapter tests) can
// still override the mock with their own `vi.mock('vscode', ...)`
// calls — per-test mocks take precedence.
//
// The mock is intentionally minimal: it provides the class
// constructors + runtime values that any of the transitively-
// loaded modules reference at import time. Functions that tests
// may call later (vscode.window.showInformationMessage, etc.) are
// stubbed as needed by individual tests.

import { vi } from 'vitest';

vi.mock('vscode', () => {
  class LanguageModelTextPart {
    constructor(public value: string) {}
  }
  class LanguageModelToolCallPart {
    constructor(
      public callId: string,
      public name: string,
      public input: unknown,
    ) {}
  }
  class LanguageModelToolResultPart {
    constructor(
      public callId: string,
      public content: LanguageModelTextPart[],
    ) {}
  }
  class LanguageModelChatMessage {
    constructor(
      public role: number,
      public content: Array<
        LanguageModelTextPart | LanguageModelToolCallPart | LanguageModelToolResultPart | string
      >,
    ) {}
    static User(content: unknown) {
      return new LanguageModelChatMessage(1, content as never);
    }
    static Assistant(content: unknown) {
      return new LanguageModelChatMessage(2, content as never);
    }
  }

  class EventEmitter<T> {
    private readonly listeners: Array<(value: T) => void> = [];
    event = (listener: (value: T) => void) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
    fire(value: T) {
      for (const listener of this.listeners) listener(value);
    }
    dispose() {
      this.listeners.length = 0;
    }
  }

  return {
    LanguageModelTextPart,
    LanguageModelToolCallPart,
    LanguageModelToolResultPart,
    LanguageModelChatMessage,
    LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
    EventEmitter,
    workspace: {
      workspaceFolders: undefined,
      getConfiguration: () => ({ get: <T>(_key: string, defaultValue: T) => defaultValue }),
    },
    window: {
      createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
    },
    commands: {
      registerCommand: () => ({ dispose: () => {} }),
      executeCommand: async () => undefined,
    },
    Uri: { file: (p: string) => ({ fsPath: p }), joinPath: () => ({ fsPath: '' }) },
  };
});
