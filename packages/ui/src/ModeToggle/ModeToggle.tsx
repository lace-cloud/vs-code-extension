import type { ReactNode } from 'react';
import './ModeToggle.css';

export interface ModeToggleItem<V extends string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

export interface ModeToggleProps<V extends string> {
  value: V;
  onChange: (next: V) => void;
  items: ModeToggleItem<V>[];
  /** Accessible label for the whole group. */
  'aria-label'?: string;
}

export function ModeToggle<V extends string>({
  value,
  onChange,
  items,
  'aria-label': ariaLabel,
}: ModeToggleProps<V>) {
  return (
    <div className="lace-mode-toggle" role="group" aria-label={ariaLabel}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            className="lace-mode-toggle__item"
            aria-pressed={selected}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled && !selected) onChange(item.value);
            }}
            title={item.title}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
