// Per-test vscode mock factory.
//
// PR A deleted the global vitest.setup.ts vscode mock as part of the
// greenfield host split — vscode-free packages must run their tests
// with no ambient vscode shim. Chat-sidebar tests that exercise the
// VS Code adapter explicitly install this mock at the top of the
// file via:
//
//   import { vi } from 'vitest';
//   import { createVscodeMock } from './test-utils/vscode-mock';
//   vi.mock('vscode', () => createVscodeMock());
//
// Per-file mocks make scope explicit at the call site — no implicit
// ambient state. The factory shape matches the minimal vscode surface
// the chat-sidebar adapter touches; expand as new adapter code under
// test reaches for additional vscode APIs.

export function createVscodeMock() {
  // ── LM part classes ──
  // Stand-ins for VS Code's `LanguageModel*Part` runtime classes.
  // Real classes carry no extra behaviour beyond the constructor —
  // these mirror that exactly so `instanceof` checks in
  // vscode-part-codec work.
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

  // ── Chat message ──
  // Real factory functions accept either a string or an array of
  // parts; the factory returns an instance carrying role + content.
  class LanguageModelChatMessage {
    constructor(
      public role: number,
      public content: unknown,
    ) {}
    static User(content: unknown) {
      return new LanguageModelChatMessage(1, content);
    }
    static Assistant(content: unknown) {
      return new LanguageModelChatMessage(2, content);
    }
  }

  // ── EventEmitter ──
  // Minimal Disposable-returning subscribe API + a `fire` for tests.
  class EventEmitter<T> {
    private readonly listeners: Array<(value: T) => void> = [];
    event = (listener: (value: T) => void) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          const i = this.listeners.indexOf(listener);
          if (i >= 0) this.listeners.splice(i, 1);
        },
      };
    };
    fire(value: T) {
      for (const listener of this.listeners) listener(value);
    }
    dispose() {
      this.listeners.length = 0;
    }
  }

  // ── TreeView primitives ──
  // Used by deploy/runs-tree-provider. Instances are compared
  // structurally in tests; the mock mirrors the shape rather than
  // any behaviour.
  class TreeItem {
    description: string | undefined;
    tooltip: string | undefined;
    iconPath: unknown;
    contextValue: string | undefined;
    command: unknown;
    constructor(
      public label: string,
      public collapsibleState: number = 0,
    ) {}
  }
  const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
  class ThemeIcon {
    constructor(public id: string) {}
  }

  return {
    LanguageModelTextPart,
    LanguageModelToolCallPart,
    LanguageModelToolResultPart,
    LanguageModelChatMessage,
    LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
    EventEmitter,
    TreeItem,
    TreeItemCollapsibleState,
    ThemeIcon,
    workspace: {
      workspaceFolders: undefined as
        | undefined
        | Array<{ uri: { fsPath: string }; name: string; index: number }>,
      getConfiguration: () => ({
        get: <T>(_key: string, defaultValue: T) => defaultValue,
      }),
    },
    window: {
      createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
      showErrorMessage: () => Promise.resolve(undefined),
      showInformationMessage: () => Promise.resolve(undefined),
    },
    commands: {
      registerCommand: () => ({ dispose: () => {} }),
      executeCommand: async () => undefined,
    },
    Uri: {
      file: (p: string) => ({ fsPath: p }),
      joinPath: (..._args: unknown[]) => ({ fsPath: '' }),
    },
  };
}
