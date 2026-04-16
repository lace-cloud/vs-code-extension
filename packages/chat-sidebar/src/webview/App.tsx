import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CompletedTurn,
  ContextSummary,
  HostToWebview,
  ProactiveSuggestion,
  WebviewToHost,
} from '../protocol';
import { ContextStrip } from './components/ContextStrip';
import { Input } from './components/Input';
import { Thread, type ThreadMessage } from './components/Thread';

type VsCodeApi = { postMessage(msg: unknown): void };

type AppProps = { vscode: VsCodeApi };

export function App({ vscode }: AppProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [context, setContext] = useState<ContextSummary | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [engineUnavailable, setEngineUnavailable] = useState(false);
  const currentAssistantRef = useRef<string>('');

  const post = useCallback(
    (msg: WebviewToHost) => {
      vscode.postMessage(msg);
    },
    [vscode],
  );

  useEffect(() => {
    const handler = (event: MessageEvent<HostToWebview>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'history':
          setMessages(completedTurnsToMessages(msg.turns));
          break;
        case 'token':
          setIsStreaming(true);
          currentAssistantRef.current += msg.text;
          setMessages((prev) => updateOrAppendAssistant(prev, currentAssistantRef.current));
          break;
        case 'tool-call':
          setMessages((prev) => [
            ...prev,
            { kind: 'tool-call', callId: msg.callId, name: msg.name, input: msg.input },
          ]);
          break;
        case 'tool-result':
          setMessages((prev) =>
            prev.map((m) =>
              m.kind === 'tool-call' && m.callId === msg.callId
                ? {
                    kind: 'tool-call',
                    callId: msg.callId,
                    name: msg.name,
                    input: m.input,
                    result: { content: msg.content, isError: msg.isError },
                  }
                : m,
            ),
          );
          break;
        case 'turn-complete':
          setIsStreaming(false);
          currentAssistantRef.current = '';
          break;
        case 'turn-cancelled':
          setIsStreaming(false);
          currentAssistantRef.current = '';
          break;
        case 'history-cleared':
          setMessages([]);
          currentAssistantRef.current = '';
          break;
        case 'no-model':
          setMessages((prev) => [
            ...prev,
            {
              kind: 'system',
              text: 'No language model available. Sign in to Copilot or configure a model.',
            },
          ]);
          setIsStreaming(false);
          break;
        case 'engine-unavailable':
          setEngineUnavailable(true);
          setIsStreaming(false);
          break;
        case 'context-summary':
          setContext(msg.summary);
          setEngineUnavailable(false);
          break;
        case 'proactive-suggestion':
          setMessages((prev) => [...prev, { kind: 'suggestion', suggestion: msg.suggestion }]);
          break;
      }
    };
    window.addEventListener('message', handler);
    post({ type: 'webview-ready' });
    return () => window.removeEventListener('message', handler);
  }, [post]);

  const handleSend = useCallback(
    (text: string) => {
      if (engineUnavailable) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      setMessages((prev) => [...prev, { kind: 'user', text: trimmed }]);
      post({ type: 'user-turn', text: trimmed });
    },
    [post, engineUnavailable],
  );

  const handleCancel = useCallback(() => {
    post({ type: 'cancel-turn' });
  }, [post]);

  const handleAcceptSuggestion = useCallback(
    (s: ProactiveSuggestion) => {
      post({ type: 'accept-proactive-suggestion', id: s.id });
      handleSend(s.text);
    },
    [post, handleSend],
  );

  return (
    <div className="lace-chat-app">
      <ContextStrip context={context} engineUnavailable={engineUnavailable} />
      <Thread messages={messages} onAcceptSuggestion={handleAcceptSuggestion} />
      <Input
        onSend={handleSend}
        onCancel={handleCancel}
        disabled={engineUnavailable}
        isStreaming={isStreaming}
      />
    </div>
  );
}

// ── Helpers ──

function completedTurnsToMessages(turns: CompletedTurn[]): ThreadMessage[] {
  const result: ThreadMessage[] = [];
  for (const turn of turns) {
    result.push({ kind: 'user', text: turn.userText });
    for (const tc of turn.toolCalls) {
      result.push({
        kind: 'tool-call',
        callId: `${turn.messageId}-${tc.name}`,
        name: tc.name,
        input: tc.input,
        result: { content: tc.resultContent, isError: tc.isError },
      });
    }
    if (turn.assistantText) {
      result.push({ kind: 'assistant', text: turn.assistantText });
    }
  }
  return result;
}

function updateOrAppendAssistant(prev: ThreadMessage[], text: string): ThreadMessage[] {
  // If the last message is an in-progress assistant message, update it;
  // otherwise append a new one. In-progress is detected by being the last
  // message and of kind 'assistant'.
  const last = prev[prev.length - 1];
  if (last && last.kind === 'assistant') {
    return [...prev.slice(0, -1), { kind: 'assistant', text }];
  }
  return [...prev, { kind: 'assistant', text }];
}
