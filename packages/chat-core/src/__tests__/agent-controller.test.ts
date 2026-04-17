// @vitest-environment node

import { describe, expect, test, vi } from 'vitest';
import {
  AgentController,
  type AgentControllerOptions,
  type ChatHostAdapter,
  type ChatMessage,
  type ChatModel,
  type ChatStreamEvent,
  createToolRegistry,
  type HostToWebview,
  type ToolRegistry,
  type ToolSchema,
  type WebviewToHost,
  type WebviewTransport,
} from '../index';

// ── Test doubles ──

type SendRequestCall = {
  messages: ChatMessage[];
  tools: ToolSchema[];
  signal: AbortSignal;
};

function makeAdapter(
  opts: {
    model?: ChatModel | null;
    scripted: ChatStreamEvent[][];
    historyLoad?: ChatMessage[] | null;
    sendRequestCalls?: SendRequestCall[];
  } = { scripted: [] },
): ChatHostAdapter {
  const fakeModel: ChatModel = {} as ChatModel;
  const calls = opts.sendRequestCalls ?? [];
  let round = 0;
  return {
    async selectModel() {
      return opts.model === undefined ? fakeModel : opts.model;
    },
    async *sendRequest(_model, messages, tools, signal) {
      calls.push({ messages: [...messages], tools: [...tools], signal });
      const events = opts.scripted[round] ?? [];
      round += 1;
      for (const event of events) {
        if (signal.aborted) return;
        yield event;
      }
    },
    async saveHistory() {},
    async loadHistory() {
      return opts.historyLoad ?? null;
    },
    getConfig(_key, defaultValue) {
      return defaultValue;
    },
    getWorkspaceName() {
      return 'test-workspace';
    },
    log() {},
  };
}

function makeTransport(): {
  transport: WebviewTransport;
  posted: HostToWebview[];
  fire: (msg: WebviewToHost) => void;
} {
  const posted: HostToWebview[] = [];
  const listeners: Array<(msg: WebviewToHost) => void> = [];
  return {
    transport: {
      postMessage: (msg) => posted.push(msg),
      onMessage: (listener) => {
        listeners.push(listener);
        return {
          dispose: () => {
            const idx = listeners.indexOf(listener);
            if (idx >= 0) listeners.splice(idx, 1);
          },
        };
      },
    },
    posted,
    fire: (msg: WebviewToHost) => {
      for (const l of [...listeners]) l(msg);
    },
  };
}

function makeOptions(overrides: Partial<AgentControllerOptions> = {}): AgentControllerOptions {
  const registry: ToolRegistry = overrides.toolRegistry ?? createToolRegistry();
  const adapter = overrides.adapter ?? makeAdapter();
  const transport = overrides.transport ?? makeTransport().transport;
  return {
    adapter,
    transport,
    toolRegistry: registry,
    buildSystemPrompt: () => 'test system prompt',
    getAvailableSystems: () => ['aws'],
    getCanvasView: () => null,
    historyKey: 'test.history',
    ...overrides,
  };
}

// ── Tests ──

describe('AgentController', () => {
  test('simple text response: streams tokens and completes', async () => {
    const sendRequestCalls: SendRequestCall[] = [];
    const adapter = makeAdapter({
      scripted: [
        [
          { type: 'text', value: 'hi' },
          { type: 'text', value: ' there' },
        ],
      ],
      sendRequestCalls,
    });
    const { transport, posted, fire } = makeTransport();
    const agent = new AgentController(makeOptions({ adapter, transport }));
    await agent.init();

    await new Promise<void>((resolve) => {
      const originalPost = transport.postMessage;
      transport.postMessage = (msg) => {
        originalPost(msg);
        if (msg.type === 'turn-complete') resolve();
      };
      fire({ type: 'user-turn', text: 'hello' });
    });

    const tokens = posted
      .filter((m) => m.type === 'token')
      .map((m) => (m as { text: string }).text);
    expect(tokens).toEqual(['hi', ' there']);
    expect(posted.some((m) => m.type === 'turn-complete')).toBe(true);
    expect(sendRequestCalls).toHaveLength(1);
  });

  test('no-model: emits no-model event and skips the turn', async () => {
    const adapter = makeAdapter({ model: null, scripted: [] });
    const { transport, posted, fire } = makeTransport();
    const agent = new AgentController(makeOptions({ adapter, transport }));
    await agent.init();
    fire({ type: 'user-turn', text: 'hello' });
    await flushMicrotasks();

    expect(posted.some((m) => m.type === 'no-model')).toBe(true);
    expect(posted.some((m) => m.type === 'token')).toBe(false);
    expect(posted.some((m) => m.type === 'turn-complete')).toBe(false);
  });

  test('tool-call + tool-result round: dispatches handler and loops', async () => {
    const handler = vi.fn().mockResolvedValue({ content: 'tool response' });
    const registry = createToolRegistry();
    registry.register(
      { name: 'my_tool', description: 'x', inputSchema: { type: 'object' } },
      handler,
    );
    const adapter = makeAdapter({
      scripted: [
        [{ type: 'tool-call', callId: 'c1', name: 'my_tool', input: { x: 1 } }],
        [{ type: 'text', value: 'done' }],
      ],
    });
    const { transport, posted, fire } = makeTransport();
    const agent = new AgentController(makeOptions({ adapter, transport, toolRegistry: registry }));
    await agent.init();

    await new Promise<void>((resolve) => {
      const originalPost = transport.postMessage;
      transport.postMessage = (msg) => {
        originalPost(msg);
        if (msg.type === 'turn-complete') resolve();
      };
      fire({ type: 'user-turn', text: 'hello' });
    });

    expect(handler).toHaveBeenCalledWith({ x: 1 });
    const toolCalls = posted.filter((m) => m.type === 'tool-call');
    const toolResults = posted.filter((m) => m.type === 'tool-result');
    expect(toolCalls).toHaveLength(1);
    expect(toolResults).toHaveLength(1);
    expect((toolResults[0] as { content: string }).content).toBe('tool response');
  });

  test('unknown tool: posts error result without calling any handler', async () => {
    const registry = createToolRegistry();
    const adapter = makeAdapter({
      scripted: [
        [{ type: 'tool-call', callId: 'c1', name: 'missing_tool', input: {} }],
        [{ type: 'text', value: 'done' }],
      ],
    });
    const { transport, posted, fire } = makeTransport();
    const agent = new AgentController(makeOptions({ adapter, transport, toolRegistry: registry }));
    await agent.init();

    await new Promise<void>((resolve) => {
      const originalPost = transport.postMessage;
      transport.postMessage = (msg) => {
        originalPost(msg);
        if (msg.type === 'turn-complete') resolve();
      };
      fire({ type: 'user-turn', text: 'hello' });
    });

    const toolResults = posted.filter((m) => m.type === 'tool-result');
    expect(toolResults).toHaveLength(1);
    const result = toolResults[0] as { isError?: boolean; content: string };
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown tool');
  });

  test('handler throw: captured as error tool-result', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    const registry = createToolRegistry();
    registry.register(
      { name: 'my_tool', description: 'x', inputSchema: { type: 'object' } },
      handler,
    );
    const adapter = makeAdapter({
      scripted: [
        [{ type: 'tool-call', callId: 'c1', name: 'my_tool', input: {} }],
        [{ type: 'text', value: 'done' }],
      ],
    });
    const { transport, posted, fire } = makeTransport();
    const agent = new AgentController(makeOptions({ adapter, transport, toolRegistry: registry }));
    await agent.init();

    await new Promise<void>((resolve) => {
      const originalPost = transport.postMessage;
      transport.postMessage = (msg) => {
        originalPost(msg);
        if (msg.type === 'turn-complete') resolve();
      };
      fire({ type: 'user-turn', text: 'hello' });
    });

    const toolResults = posted.filter((m) => m.type === 'tool-result');
    expect(toolResults).toHaveLength(1);
    const result = toolResults[0] as { isError?: boolean; content: string };
    expect(result.isError).toBe(true);
    expect(result.content).toContain('boom');
  });

  test('stuck-loop detection: same failing tool twice (with a succeeding sibling) breaks out', async () => {
    // The stuck-loop guard only trips when SOME tool in the round succeeds
    // — otherwise `allToolsErrored` breaks the loop first. So we pair a
    // reliably-succeeding tool with a reliably-failing one and check that
    // after the failing signature repeats twice, the loop stops.
    const goodHandler = vi.fn().mockResolvedValue({ content: 'ok' });
    const flakyHandler = vi.fn().mockResolvedValue({ content: 'nope', isError: true });
    const registry = createToolRegistry();
    registry.register(
      { name: 'good', description: 'x', inputSchema: { type: 'object' } },
      goodHandler,
    );
    registry.register(
      { name: 'flaky', description: 'x', inputSchema: { type: 'object' } },
      flakyHandler,
    );
    const adapter = makeAdapter({
      scripted: [
        [
          { type: 'tool-call', callId: 'g1', name: 'good', input: {} },
          { type: 'tool-call', callId: 'f1', name: 'flaky', input: { x: 1 } },
        ],
        [
          { type: 'tool-call', callId: 'g2', name: 'good', input: {} },
          { type: 'tool-call', callId: 'f2', name: 'flaky', input: { x: 1 } },
        ],
        [
          { type: 'tool-call', callId: 'g3', name: 'good', input: {} },
          { type: 'tool-call', callId: 'f3', name: 'flaky', input: { x: 1 } },
        ],
      ],
    });
    const { transport, posted, fire } = makeTransport();
    const agent = new AgentController(makeOptions({ adapter, transport, toolRegistry: registry }));
    await agent.init();

    await new Promise<void>((resolve) => {
      const originalPost = transport.postMessage;
      transport.postMessage = (msg) => {
        originalPost(msg);
        if (msg.type === 'turn-complete') resolve();
      };
      fire({ type: 'user-turn', text: 'hello' });
    });

    // Flaky invoked twice (rounds 0 and 1) → stuck-loop fires → third
    // round never happens.
    expect(flakyHandler).toHaveBeenCalledTimes(2);
    expect(goodHandler).toHaveBeenCalledTimes(2);
    const stuckMessage = posted.find(
      (m) => m.type === 'token' && (m as { text: string }).text.includes("I'm stuck"),
    );
    expect(stuckMessage).toBeDefined();
  });

  test('all-tools-errored: single failing tool breaks out immediately', async () => {
    const handler = vi.fn().mockResolvedValue({ content: 'nope', isError: true });
    const registry = createToolRegistry();
    registry.register(
      { name: 'broken', description: 'x', inputSchema: { type: 'object' } },
      handler,
    );
    const adapter = makeAdapter({
      scripted: [
        [{ type: 'tool-call', callId: 'c1', name: 'broken', input: {} }],
        [{ type: 'tool-call', callId: 'c2', name: 'broken', input: {} }],
      ],
    });
    const { transport, posted, fire } = makeTransport();
    const agent = new AgentController(makeOptions({ adapter, transport, toolRegistry: registry }));
    await agent.init();

    await new Promise<void>((resolve) => {
      const originalPost = transport.postMessage;
      transport.postMessage = (msg) => {
        originalPost(msg);
        if (msg.type === 'turn-complete') resolve();
      };
      fire({ type: 'user-turn', text: 'hello' });
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const allErroredMsg = posted.find(
      (m) => m.type === 'token' && (m as { text: string }).text.includes('All tool calls failed'),
    );
    expect(allErroredMsg).toBeDefined();
  });

  test('cancel mid-stream: turn-cancelled emitted, no turn-complete', async () => {
    const handler = vi.fn();
    const registry = createToolRegistry();
    registry.register(
      { name: 'slow_tool', description: 'x', inputSchema: { type: 'object' } },
      handler,
    );
    // A never-resolving stream for round 1, so the controller sits waiting
    // for the next event when we cancel.
    const adapter: ChatHostAdapter = {
      async selectModel() {
        return {} as ChatModel;
      },
      async *sendRequest(_model, _messages, _tools, signal) {
        yield { type: 'text', value: 'partial' };
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      },
      async saveHistory() {},
      async loadHistory() {
        return null;
      },
      getConfig<T>(_key: string, defaultValue: T): T {
        return defaultValue;
      },
      getWorkspaceName() {
        return null;
      },
      log() {},
    };
    const { transport, posted, fire } = makeTransport();
    const agent = new AgentController(makeOptions({ adapter, transport, toolRegistry: registry }));
    await agent.init();

    const cancelled = new Promise<void>((resolve) => {
      const originalPost = transport.postMessage;
      transport.postMessage = (msg) => {
        originalPost(msg);
        if (msg.type === 'turn-cancelled') resolve();
      };
    });

    fire({ type: 'user-turn', text: 'hello' });
    // Give the stream a tick to emit the partial token
    await flushMicrotasks();
    fire({ type: 'cancel-turn' });
    await cancelled;

    expect(posted.some((m) => m.type === 'turn-cancelled')).toBe(true);
    expect(posted.some((m) => m.type === 'turn-complete')).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  test('init hydrates history from adapter.loadHistory', async () => {
    const hydrated: ChatMessage[] = [
      { role: 'user', content: [{ kind: 'text', value: 'prior message' }] },
    ];
    const sendRequestCalls: SendRequestCall[] = [];
    const adapter = makeAdapter({
      historyLoad: hydrated,
      scripted: [[{ type: 'text', value: 'ok' }]],
      sendRequestCalls,
    });
    const { transport, fire, posted } = makeTransport();
    const agent = new AgentController(makeOptions({ adapter, transport }));
    await agent.init();

    await new Promise<void>((resolve) => {
      const originalPost = transport.postMessage;
      transport.postMessage = (msg) => {
        originalPost(msg);
        if (msg.type === 'turn-complete') resolve();
      };
      fire({ type: 'user-turn', text: 'next' });
    });

    // The prior message should appear in the sendRequest messages
    // alongside the system prompt + canvas context + new user text.
    const firstCall = sendRequestCalls[0];
    const hasPrior = firstCall.messages.some(
      (m) =>
        m.role === 'user' &&
        m.content.some((p) => p.kind === 'text' && p.value === 'prior message'),
    );
    expect(hasPrior).toBe(true);
    expect(posted.some((m) => m.type === 'turn-complete')).toBe(true);
  });

  test('webview-ready: replays completed turns', async () => {
    const adapter = makeAdapter({ scripted: [[{ type: 'text', value: 'first answer' }]] });
    const { transport, posted, fire } = makeTransport();
    const agent = new AgentController(makeOptions({ adapter, transport }));
    await agent.init();

    // Run one turn to populate completedTurns
    await new Promise<void>((resolve) => {
      const originalPost = transport.postMessage;
      transport.postMessage = (msg) => {
        originalPost(msg);
        if (msg.type === 'turn-complete') resolve();
      };
      fire({ type: 'user-turn', text: 'hello' });
    });

    // Now simulate a webview mount asking for history
    const before = posted.length;
    fire({ type: 'webview-ready' });
    await flushMicrotasks();
    const history = posted.slice(before).find((m) => m.type === 'history');
    expect(history).toBeDefined();
    const turns = (history as { turns: unknown[] }).turns;
    expect(turns).toHaveLength(1);
  });

  test('clearHistory: posts history-cleared and saves empty array', async () => {
    const saveHistory = vi.fn().mockResolvedValue(undefined);
    const adapter: ChatHostAdapter = {
      ...makeAdapter(),
      saveHistory,
    };
    const { transport, posted } = makeTransport();
    const agent = new AgentController(makeOptions({ adapter, transport }));
    await agent.init();

    await agent.clearHistory();

    expect(posted.some((m) => m.type === 'history-cleared')).toBe(true);
    expect(saveHistory).toHaveBeenCalledWith('test.history', []);
  });

  test('dispose: cancels any in-flight turn', async () => {
    let aborted = false;
    const adapter: ChatHostAdapter = {
      async selectModel() {
        return {} as ChatModel;
      },
      async *sendRequest(_model, _messages, _tools, signal) {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      },
      async saveHistory() {},
      async loadHistory() {
        return null;
      },
      getConfig<T>(_key: string, defaultValue: T): T {
        return defaultValue;
      },
      getWorkspaceName() {
        return null;
      },
      log() {},
    };
    const { transport, fire } = makeTransport();
    const agent = new AgentController(makeOptions({ adapter, transport }));
    await agent.init();
    fire({ type: 'user-turn', text: 'hello' });
    await flushMicrotasks();
    agent.dispose();
    await flushMicrotasks();

    expect(aborted).toBe(true);
  });
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
