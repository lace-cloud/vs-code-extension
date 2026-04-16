import { useState } from 'react';
import type { ProactiveSuggestion } from '../../protocol';
import type { ThreadMessage } from './Thread';

type MessageItemProps = {
  message: ThreadMessage;
  onAcceptSuggestion: (s: ProactiveSuggestion) => void;
};

export function MessageItem({ message, onAcceptSuggestion }: MessageItemProps) {
  switch (message.kind) {
    case 'user':
      return (
        <div className="lace-chat-message lace-chat-user">
          <div className="lace-chat-label">You</div>
          <div className="lace-chat-body">{message.text}</div>
        </div>
      );

    case 'assistant':
      return (
        <div className="lace-chat-message lace-chat-assistant">
          <div className="lace-chat-label">Lace</div>
          <div className="lace-chat-body">{message.text}</div>
        </div>
      );

    case 'tool-call':
      return <ToolCallCard message={message} />;

    case 'suggestion':
      return (
        <div className="lace-chat-message lace-chat-suggestion">
          <div className="lace-chat-label">Suggestion</div>
          <div className="lace-chat-body">{message.suggestion.text}</div>
          <button
            className="lace-chat-suggestion-btn"
            onClick={() => onAcceptSuggestion(message.suggestion)}
          >
            Yes, do it
          </button>
        </div>
      );

    case 'system':
      return (
        <div className="lace-chat-message lace-chat-system">
          <div className="lace-chat-body">{message.text}</div>
        </div>
      );
  }
}

function ToolCallCard({ message }: { message: Extract<ThreadMessage, { kind: 'tool-call' }> }) {
  const [expanded, setExpanded] = useState(false);
  const status = message.result === undefined ? 'running' : message.result.isError ? 'error' : 'ok';
  const statusIcon = status === 'running' ? '…' : status === 'error' ? '✗' : '✓';

  return (
    <div className={`lace-chat-message lace-chat-tool-call lace-chat-tool-${status}`}>
      <button
        className="lace-chat-tool-header"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className="lace-chat-tool-icon">{statusIcon}</span>
        <span className="lace-chat-tool-name">{message.name}</span>
        <span className="lace-chat-tool-chevron">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="lace-chat-tool-body">
          <div className="lace-chat-tool-section">
            <div className="lace-chat-tool-heading">Input</div>
            <pre className="lace-chat-tool-pre">{JSON.stringify(message.input, null, 2)}</pre>
          </div>
          {message.result && (
            <div className="lace-chat-tool-section">
              <div className="lace-chat-tool-heading">Result</div>
              <pre className="lace-chat-tool-pre">{message.result.content}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
