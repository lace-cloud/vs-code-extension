import { type KeyboardEvent, useCallback, useRef, useState } from 'react';

type InputProps = {
  onSend: (text: string) => void;
  onCancel: () => void;
  disabled: boolean;
  isStreaming: boolean;
};

export function Input({ onSend, onCancel, disabled, isStreaming }: InputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(() => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
    textareaRef.current?.focus();
  }, [text, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <div className="lace-chat-input-bar">
      <textarea
        ref={textareaRef}
        className="lace-chat-input"
        placeholder={
          disabled
            ? 'Lace engine unavailable…'
            : 'Message Lace… (Enter to send, Shift+Enter for newline)'
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={3}
      />
      {isStreaming ? (
        <button className="lace-chat-cancel-btn" onClick={onCancel}>
          Stop
        </button>
      ) : (
        <button className="lace-chat-send-btn" onClick={submit} disabled={disabled || !text.trim()}>
          Send
        </button>
      )}
    </div>
  );
}
