import type { MouseEvent, ReactNode } from 'react';
import './IconButton.css';

export type IconButtonVariant = 'default' | 'danger' | 'success';
export type IconButtonSize = 'xs' | 'sm' | 'md';

export interface IconButtonProps {
  icon: ReactNode;
  /** Required — icon-only buttons have no visible text label. */
  'aria-label': string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  disabled?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
}

export function IconButton({
  icon,
  'aria-label': ariaLabel,
  variant = 'default',
  size = 'sm',
  disabled = false,
  onClick,
  title,
}: IconButtonProps) {
  const classes = ['lace-icon-btn', `lace-icon-btn--${variant}`, `lace-icon-btn--size-${size}`]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled}
      onClick={onClick}
      title={title ?? ariaLabel}
      aria-label={ariaLabel}
    >
      <span className="lace-icon-btn__icon" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}
