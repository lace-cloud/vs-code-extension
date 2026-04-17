import type { ProactiveSuggestion } from '@lace/chat-core';
import { useEffect, useRef } from 'react';
import { MessageItem } from './MessageItem';

export type ThreadMessage =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | {
      kind: 'tool-call';
      callId: string;
      name: string;
      input: unknown;
      result?: { content: string; isError?: boolean };
    }
  | { kind: 'suggestion'; suggestion: ProactiveSuggestion }
  | { kind: 'system'; text: string };

type ThreadProps = {
  messages: ThreadMessage[];
  onAcceptSuggestion: (s: ProactiveSuggestion) => void;
};

export function Thread({ messages, onAcceptSuggestion }: ThreadProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  return (
    <div className="lace-chat-thread">
      {messages.length === 0 ? (
        <div className="lace-chat-empty">
          Start a conversation. Ask Lace to compose infrastructure, add modules, or generate
          Terraform.
        </div>
      ) : (
        messages.map((m, i) => (
          <MessageItem
            key={m.kind === 'tool-call' ? `tc-${m.callId}` : `m-${i}`}
            message={m}
            onAcceptSuggestion={onAcceptSuggestion}
          />
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}
