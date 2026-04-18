import type { ChatMessage, ChatStreamEvent } from '@lace-cloud/chat-core';
import { describe, expect, test, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  abortSignalToToken,
  toVscodeMessage,
  vscodePartToCore,
  vscodeStreamToEvents,
} from '../vscode-part-codec';

// vi.mock with an async factory runs lazily at first vscode import —
// the dynamic `await import` resolves the shared factory module
// correctly. Synchronous factories are hoisted above static imports
// and can't reference outer-scope identifiers, which is why we don't
// use `import { createVscodeMock }` at the top.
vi.mock('vscode', async () => {
  const { createVscodeMock } = await import('./test-utils/vscode-mock');
  return createVscodeMock();
});

// ── Core → VS Code ──

describe('toVscodeMessage', () => {
  test('user message wraps text + tool-call + tool-result parts', () => {
    const msg: ChatMessage = {
      role: 'user',
      content: [
        { kind: 'text', value: 'hello' },
        {
          kind: 'tool-call',
          callId: 'call-1',
          name: 'lace_describe_graph',
          input: { detail: 'full' },
        },
        {
          kind: 'tool-result',
          callId: 'call-1',
          content: [{ kind: 'text', value: 'graph state...' }],
        },
      ],
    };
    const result = toVscodeMessage(msg);
    expect(result.role).toBe(vscode.LanguageModelChatMessageRole.User);
    const parts = result.content as unknown as Array<{
      value?: string;
      callId?: string;
      name?: string;
      input?: unknown;
      content?: unknown[];
    }>;
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
    expect(parts[0].value).toBe('hello');
    expect(parts[1]).toBeInstanceOf(vscode.LanguageModelToolCallPart);
    expect(parts[1].callId).toBe('call-1');
    expect(parts[1].name).toBe('lace_describe_graph');
    expect(parts[1].input).toEqual({ detail: 'full' });
    expect(parts[2]).toBeInstanceOf(vscode.LanguageModelToolResultPart);
    expect(parts[2].callId).toBe('call-1');
    const inner = parts[2].content as Array<{ value: string }>;
    expect(inner).toHaveLength(1);
    expect(inner[0].value).toBe('graph state...');
  });

  test('assistant message uses Assistant role', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: [{ kind: 'text', value: 'sure thing' }],
    };
    const result = toVscodeMessage(msg);
    expect(result.role).toBe(vscode.LanguageModelChatMessageRole.Assistant);
  });

  test('tool-call with undefined input becomes empty object', () => {
    const msg: ChatMessage = {
      role: 'user',
      content: [{ kind: 'tool-call', callId: 'c', name: 'noop', input: undefined }],
    };
    const result = toVscodeMessage(msg);
    const parts = result.content as unknown as Array<{ input: unknown }>;
    expect(parts[0].input).toEqual({});
  });
});

// ── VS Code stream → Core stream events ──

describe('vscodeStreamToEvents', () => {
  test('yields text events for LanguageModelTextPart', async () => {
    const stream = (async function* () {
      yield new vscode.LanguageModelTextPart('one');
      yield new vscode.LanguageModelTextPart('two');
    })();

    const events: ChatStreamEvent[] = [];
    for await (const ev of vscodeStreamToEvents(stream)) events.push(ev);

    expect(events).toEqual([
      { type: 'text', value: 'one' },
      { type: 'text', value: 'two' },
    ]);
  });

  test('yields tool-call events for LanguageModelToolCallPart', async () => {
    const stream = (async function* () {
      yield new vscode.LanguageModelToolCallPart('c1', 'lace_add_module', { name: 'aws_vpc' });
    })();

    const events: ChatStreamEvent[] = [];
    for await (const ev of vscodeStreamToEvents(stream)) events.push(ev);

    expect(events).toEqual([
      { type: 'tool-call', callId: 'c1', name: 'lace_add_module', input: { name: 'aws_vpc' } },
    ]);
  });

  test('silently drops unknown part kinds (forward-compat)', async () => {
    class UnknownPart {
      constructor(public payload: string) {}
    }
    const stream = (async function* () {
      yield new vscode.LanguageModelTextPart('keep');
      yield new UnknownPart('drop');
      yield new vscode.LanguageModelTextPart('keep-too');
    })();

    const events: ChatStreamEvent[] = [];
    for await (const ev of vscodeStreamToEvents(stream)) events.push(ev);

    expect(events.map((e) => (e.type === 'text' ? e.value : null))).toEqual(['keep', 'keep-too']);
  });
});

// ── AbortSignal → vscode.CancellationToken ──

describe('abortSignalToToken', () => {
  test('not-yet-aborted signal exposes isCancellationRequested=false', () => {
    const controller = new AbortController();
    const token = abortSignalToToken(controller.signal);
    expect(token.isCancellationRequested).toBe(false);
  });

  test('aborting after token creation flips isCancellationRequested + fires onCancellationRequested', () => {
    const controller = new AbortController();
    const token = abortSignalToToken(controller.signal);
    let fired = false;
    token.onCancellationRequested(() => {
      fired = true;
    });

    controller.abort();
    expect(token.isCancellationRequested).toBe(true);
    // The emitter fires synchronously on the abort event.
    expect(fired).toBe(true);
  });

  test('already-aborted signal fires onCancellationRequested asynchronously after subscribers attach', async () => {
    const controller = new AbortController();
    controller.abort();
    const token = abortSignalToToken(controller.signal);
    expect(token.isCancellationRequested).toBe(true);

    let fired = false;
    token.onCancellationRequested(() => {
      fired = true;
    });

    // The factory uses setTimeout(..., 0) so subscribers attached
    // before the next microtask still observe the fire.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(fired).toBe(true);
  });
});

// ── VS Code → Core (text-part extraction for history restore) ──

describe('vscodePartToCore', () => {
  test('text part round-trips', () => {
    const part = new vscode.LanguageModelTextPart('hello');
    expect(vscodePartToCore(part)).toEqual({ kind: 'text', value: 'hello' });
  });

  test('tool-call part round-trips with full payload', () => {
    const part = new vscode.LanguageModelToolCallPart('c1', 'lace_validate_graph', {
      strict: true,
    });
    expect(vscodePartToCore(part)).toEqual({
      kind: 'tool-call',
      callId: 'c1',
      name: 'lace_validate_graph',
      input: { strict: true },
    });
  });

  test('tool-result part keeps text-only inner content (drops non-text)', () => {
    class NonTextPart {
      constructor(public mime: string) {}
    }
    const inner = [
      new vscode.LanguageModelTextPart('text-1'),
      new NonTextPart('image/png') as unknown as InstanceType<typeof vscode.LanguageModelTextPart>,
      new vscode.LanguageModelTextPart('text-2'),
    ];
    const part = new vscode.LanguageModelToolResultPart('c1', inner);
    expect(vscodePartToCore(part)).toEqual({
      kind: 'tool-result',
      callId: 'c1',
      content: [
        { kind: 'text', value: 'text-1' },
        { kind: 'text', value: 'text-2' },
      ],
    });
  });

  test('returns null for unrecognised part class', () => {
    class UnknownPart {
      constructor(public x: number) {}
    }
    expect(
      vscodePartToCore(
        new UnknownPart(42) as unknown as InstanceType<typeof vscode.LanguageModelTextPart>,
      ),
    ).toBeNull();
  });
});
