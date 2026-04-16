import type { ContextSummary } from '../../protocol';

type ContextStripProps = {
  context: ContextSummary | null;
  engineUnavailable: boolean;
};

export function ContextStrip({ context, engineUnavailable }: ContextStripProps) {
  if (engineUnavailable) {
    return (
      <div className="lace-chat-context lace-chat-context-error">
        Lace engine unavailable — start it with <strong>Lace: Start Engine</strong>
      </div>
    );
  }

  if (!context) {
    return <div className="lace-chat-context">Connecting to engine…</div>;
  }

  const nodes = `${context.nodeCount} node${context.nodeCount === 1 ? '' : 's'}`;
  const errors =
    context.errorCount > 0
      ? ` · ${context.errorCount} error${context.errorCount === 1 ? '' : 's'}`
      : '';
  return (
    <div className="lace-chat-context">
      Canvas: {nodes}
      {errors}
      {context.sessionId ? ` · ${context.sessionId.slice(0, 12)}` : ''}
    </div>
  );
}
