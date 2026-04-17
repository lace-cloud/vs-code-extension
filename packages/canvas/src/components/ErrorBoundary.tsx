import React from 'react';
import './ErrorBoundary.css';

type ErrorStateProps = { message: string };

export function ErrorState({ message }: ErrorStateProps) {
  return (
    <div className="lace-error-state" role="alert">
      <h3 className="lace-error-state__title">Something went wrong</h3>
      <pre className="lace-error-state__message">{message}</pre>
      <button
        type="button"
        className="lace-error-state__reload"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </div>
  );
}

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <ErrorState message={this.state.error.message} />;
    }
    return this.props.children;
  }
}
