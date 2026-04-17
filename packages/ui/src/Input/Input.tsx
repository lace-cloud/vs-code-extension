import type { ChangeEvent, KeyboardEvent, Ref } from 'react';
import './Input.css';

export type InputType = 'text' | 'password' | 'number' | 'email' | 'url' | 'search';

export interface InputProps {
  value: string;
  /** Omit for read-only display; React still treats the input as
   * controlled (no spurious warning) because `readOnly` is set. */
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  type?: InputType;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  /** Shows an error-colored border. */
  error?: boolean;
  /** Stretches the input to its container's width. */
  fullWidth?: boolean;
  /** Switches to a monospace font — used for code/config fields. */
  mono?: boolean;
  title?: string;
  'aria-label'?: string;
  inputRef?: Ref<HTMLInputElement>;
}

export function Input({
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled = false,
  readOnly = false,
  autoFocus = false,
  onKeyDown,
  onBlur,
  error = false,
  fullWidth = false,
  mono = false,
  title,
  'aria-label': ariaLabel,
  inputRef,
}: InputProps) {
  const classes = [
    'lace-input',
    error ? 'lace-input--error' : '',
    fullWidth ? 'lace-input--full-width' : '',
    mono ? 'lace-input--mono' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <input
      ref={inputRef}
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
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
