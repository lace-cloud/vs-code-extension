import type { ToastState } from '../hooks/useToast';
import './Toast.css';

type Props = {
  toast: ToastState;
};

export default function Toast({ toast }: Props) {
  if (!toast) return null;
  const variant =
    toast.type === 'error' ? 'error' : toast.type === 'progress' ? 'progress' : 'success';
  return (
    <div className={`lace-toast lace-toast--${variant}`}>
      {toast.type === 'progress' && <div className="lace-toast__spinner" aria-hidden="true" />}
      {toast.message}
    </div>
  );
}
