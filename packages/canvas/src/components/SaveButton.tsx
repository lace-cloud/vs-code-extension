import { Button, type ButtonVariant } from '@lace/ui';
import type { SaveStatus } from '../hooks/useSaveState';

type Props = {
  status: SaveStatus;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledTitle?: string;
};

// Status → UI-primitive mapping. `idle` uses the caller-supplied label; the
// other statuses carry their own user-facing text since the status itself
// is the message (saving, saved, error). `saving` is represented by loading
// state on the primary Button so the spinner renders consistently with any
// other loading button in the app.
const variantByStatus: Record<SaveStatus, ButtonVariant> = {
  idle: 'primary',
  saving: 'primary',
  saved: 'success',
  error: 'danger',
};

const labelByStatus: Record<Exclude<SaveStatus, 'idle'>, string> = {
  saving: 'Saving…',
  saved: 'Saved!',
  error: 'Save failed — try again',
};

export default function SaveButton({ status, label, onClick, disabled, disabledTitle }: Props) {
  return (
    <Button
      variant={variantByStatus[status]}
      fullWidth
      loading={status === 'saving'}
      disabled={disabled || status === 'saved'}
      onClick={onClick}
      title={disabled ? disabledTitle : undefined}
    >
      {status === 'idle' ? label : labelByStatus[status]}
    </Button>
  );
}
