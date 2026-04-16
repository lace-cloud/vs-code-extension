import { describe, expect, test, vi } from 'vitest';

// Mock vscode module — history-codec uses instanceof checks and constructor calls.
// Each mocked class is a minimal shape matching the real vscode API.
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
  const LanguageModelChatMessageRole = { User: 1, Assistant: 2 } as const;

  return {
    LanguageModelTextPart,
    LanguageModelToolCallPart,
    LanguageModelToolResultPart,
    LanguageModelChatMessage,
    LanguageModelChatMessageRole,
  };
});

// Import after mock is set up.
import * as vscode from 'vscode';
import { capToRecent, hydrate, type SerializedMessage, serialize } from '../host/history-codec';

describe('history-codec', () => {
  describe('serialize', () => {
    test('handles user text message', () => {
      const msg = vscode.LanguageModelChatMessage.User([new vscode.LanguageModelTextPart('hello')]);
      const result = serialize([msg]);
      expect(result).toEqual([{ role: 'user', content: [{ kind: 'text', value: 'hello' }] }]);
    });

    test('handles assistant message with text and tool call', () => {
      const msg = vscode.LanguageModelChatMessage.Assistant([
        new vscode.LanguageModelTextPart('thinking...'),
        new vscode.LanguageModelToolCallPart('call-1', 'lace_add_module', { name: 'aws/vpc' }),
      ]);
      const result = serialize([msg]);
      expect(result).toEqual([
        {
          role: 'assistant',
          content: [
            { kind: 'text', value: 'thinking...' },
            {
              kind: 'tool-call',
              callId: 'call-1',
              name: 'lace_add_module',
              input: { name: 'aws/vpc' },
            },
          ],
        },
      ]);
    });

    test('handles tool result message', () => {
      const msg = vscode.LanguageModelChatMessage.User([
        new vscode.LanguageModelToolResultPart('call-1', [
          new vscode.LanguageModelTextPart('Added aws/vpc as instance "vpc"'),
        ]),
      ]);
      const result = serialize([msg]);
      expect(result).toEqual([
        {
          role: 'user',
          content: [
            {
              kind: 'tool-result',
              callId: 'call-1',
              content: [{ kind: 'text', value: 'Added aws/vpc as instance "vpc"' }],
            },
          ],
        },
      ]);
    });

    test('drops unknown part kinds with a warning (forward-compat)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const unknown = { weirdFutureKind: 'data' };
      const msg = vscode.LanguageModelChatMessage.User([
        new vscode.LanguageModelTextPart('keep this'),
        unknown as never,
      ]);
      const result = serialize([msg]);
      expect(result).toEqual([{ role: 'user', content: [{ kind: 'text', value: 'keep this' }] }]);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('hydrate', () => {
    test('round-trips a user text message', () => {
      const serialized: SerializedMessage[] = [
        { role: 'user', content: [{ kind: 'text', value: 'hello' }] },
      ];
      const result = hydrate(serialized);
      expect(result).toHaveLength(1);
      expect(result[0].content).toHaveLength(1);
      expect((result[0].content[0] as vscode.LanguageModelTextPart).value).toBe('hello');
    });

    test('round-trips an assistant message with tool call', () => {
      const serialized: SerializedMessage[] = [
        {
          role: 'assistant',
          content: [
            { kind: 'text', value: 'calling tool' },
            { kind: 'tool-call', callId: 'c1', name: 'lace_add_module', input: { name: 'x' } },
          ],
        },
      ];
      const result = hydrate(serialized);
      expect(result).toHaveLength(1);
      expect(result[0].content).toHaveLength(2);
      const tc = result[0].content[1] as vscode.LanguageModelToolCallPart;
      expect(tc.callId).toBe('c1');
      expect(tc.name).toBe('lace_add_module');
      expect(tc.input).toEqual({ name: 'x' });
    });

    test('drops messages with zero valid parts', () => {
      const serialized: SerializedMessage[] = [{ role: 'user', content: [] }];
      const result = hydrate(serialized);
      expect(result).toHaveLength(0);
    });
  });

  describe('capToRecent', () => {
    test('returns all messages when under cap', () => {
      const messages: SerializedMessage[] = [
        { role: 'user', content: [{ kind: 'text', value: 'a' }] },
        { role: 'assistant', content: [{ kind: 'text', value: 'b' }] },
      ];
      expect(capToRecent(messages)).toEqual(messages);
    });

    test('keeps most recent when over cap', () => {
      // 51 turns = 102 messages. Cap = 50 turns = 100 messages.
      const messages: SerializedMessage[] = [];
      for (let i = 0; i < 102; i++) {
        messages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: [{ kind: 'text', value: `msg-${i}` }],
        });
      }
      const capped = capToRecent(messages);
      expect(capped).toHaveLength(100);
      // First kept message should be msg-2 (index 2), last should be msg-101 (index 101).
      expect((capped[0].content[0] as { kind: 'text'; value: string }).value).toBe('msg-2');
      expect((capped[99].content[0] as { kind: 'text'; value: string }).value).toBe('msg-101');
    });
  });
});
