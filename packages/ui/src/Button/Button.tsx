import type { MouseEvent, ReactNode } from 'react';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretches the button to its container's width. Used by panel CTAs. */
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
  'aria-label'?: string;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  loading = false,
  onClick,
  type = 'button',
  title,
  'aria-label': ariaLabel,
}: ButtonProps) {
  const classes = [
    'lace-btn',
    `lace-btn--${variant}`,
    `lace-btn--size-${size}`,
    fullWidth ? 'lace-btn--full-width' : '',
    loading ? 'lace-btn--loading' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="lace-btn__spinner" aria-hidden="true" /> : null}
      <span className="lace-btn__label">{children}</span>
    </button>
  );
}
