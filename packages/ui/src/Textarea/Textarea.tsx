import type { ChangeEvent, KeyboardEvent, Ref } from 'react';
import './Textarea.css';

export interface TextareaProps {
  value: string;
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  /** Shows an error-colored border. */
  error?: boolean;
  /** Stretches the textarea to its container's width. */
  fullWidth?: boolean;
  /** Switches to a monospace font — used for code/expression fields. */
  mono?: boolean;
  /** Hides the browser's resize handle. */
  resizable?: boolean;
  title?: string;
  'aria-label'?: string;
  textareaRef?: Ref<HTMLTextAreaElement>;
}

export function Textarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled = false,
  readOnly = false,
  autoFocus = false,
  onKeyDown,
  onBlur,
  error = false,
  fullWidth = false,
  mono = false,
  resizable = true,
  title,
  'aria-label': ariaLabel,
  textareaRef,
}: TextareaProps) {
  const classes = [
    'lace-textarea',
    error ? 'lace-textarea--error' : '',
    fullWidth ? 'lace-textarea--full-width' : '',
    mono ? 'lace-textarea--mono' : '',
    resizable ? '' : 'lace-textarea--no-resize',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      readOnly={readOnly}
      autoFocus={autoFocus}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className={classes}
      title={title}
      aria-label={ariaLabel}
      aria-invalid={error || undefined}
    />
  );
}
