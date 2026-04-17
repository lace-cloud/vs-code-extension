import type { ReactNode } from 'react';
import './Badge.css';

export type BadgeVariant = 'neutral' | 'info' | 'success' | 'danger';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  title?: string;
}

export function Badge({ children, variant = 'neutral', size = 'sm', title }: BadgeProps) {
  const classes = `lace-badge lace-badge--${variant} lace-badge--size-${size}`;
  return (
    <span className={classes} title={title}>
      {children}
    </span>
  );
}
