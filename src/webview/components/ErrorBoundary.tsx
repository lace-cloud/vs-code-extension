import React from 'react';

type ErrorStateProps = { message: string };

export function ErrorState({ message }: ErrorStateProps) {
  return (
    <div style={{ padding: 24, color: '#f44' }}>
      <h3>Something went wrong</h3>
      <pre>{message}</pre>
      <button onClick={() => window.location.reload()}>Reload</button>
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
