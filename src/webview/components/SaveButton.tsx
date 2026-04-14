import React from 'react';
import type { SaveStatus } from '../hooks/useSaveState';
import {
  saveButtonClasses,
  saveButtonSavingClasses,
  saveButtonSuccessClasses,
  saveButtonErrorClasses,
} from '../styles/panel';

type Props = {
  status: SaveStatus;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledTitle?: string;
};

const classMap: Record<SaveStatus, string> = {
  idle: saveButtonClasses,
  saving: saveButtonSavingClasses,
  saved: saveButtonSuccessClasses,
  error: saveButtonErrorClasses,
};

const textMap: Record<SaveStatus, string> = {
  saving: 'Saving...',
  saved: 'Saved!',
  error: 'Save failed \u2014 try again',
  idle: '', // overridden by label prop
};

export default function SaveButton({ status, label, onClick, disabled, disabledTitle }: Props) {
  return (
    <button
      className={classMap[status]}
      onClick={onClick}
      disabled={disabled || status === 'saving'}
      title={disabled ? disabledTitle : undefined}
      style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
    >
      {status === 'idle' ? label : textMap[status]}
    </button>
  );
}
