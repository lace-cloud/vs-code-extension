import { useState } from 'react';
import type { Diagnostic } from '../types/render';
import './ValidationErrorBanner.css';

// ── ValidationErrorDialog ──────────────────────────────────────────────────

type DialogProps = {
  diagnostics: Diagnostic[];
  nodeIds: Set<string>;
  onGoToNode: (nodeId: string) => void;
  onOpenFile: (relativePath: string, line?: number, column?: number) => void;
  onClose: () => void;
};

function ValidationErrorDialog({
  diagnostics,
  nodeIds,
  onGoToNode,
  onOpenFile,
  onClose,
}: DialogProps) {
  return (
    <div
      className="lace-error-dialog-backdrop"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
    >
      <div
        className="lace-error-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lace-error-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <header className="lace-error-dialog__header">
          <h2 id="lace-error-dialog-title" className="lace-error-dialog__title">
            Terraform Validation Errors ({diagnostics.length})
          </h2>
          <button
            type="button"
            className="lace-error-dialog__close"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="lace-error-dialog__list">
          {diagnostics.map((d, i) => {
            const nodeId = extractNodeId(d, nodeIds);
            const hasFileLink = !!d.file;
            return (
              <div key={`${d.message}-${i}`} className="lace-error-dialog__item">
                <div className="lace-error-dialog__item-message">{d.message}</div>
                {hasFileLink && (
                  <button
                    type="button"
                    className="lace-error-dialog__file-link"
                    onClick={() => onOpenFile(d.file!, d.line, d.column)}
                    title="Open file in editor"
                  >
                    {d.file}
                    {d.line != null && `:${d.line}`}
                    {d.column != null && `:${d.column}`}
                  </button>
                )}
                {nodeId && (
                  <button
                    type="button"
                    className="lace-error-dialog__node-link"
                    onClick={() => onGoToNode(nodeId)}
                  >
                    View node
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── ValidationErrorBanner ──────────────────────────────────────────────────

type BannerProps = {
  diagnostics: Diagnostic[];
  nodeIds: Set<string>;
  onGoToNode: (nodeId: string) => void;
  onOpenFile: (relativePath: string, line?: number, column?: number) => void;
  onDismiss: () => void;
};

export function ValidationErrorBanner({
  diagnostics,
  nodeIds,
  onGoToNode,
  onOpenFile,
  onDismiss,
}: BannerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (diagnostics.length === 0) return null;

  return (
    <>
      <div className="lace-error-banner" role="status">
        <svg
          className="lace-error-banner__icon"
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 3.5c.28 0 .5.22.5.5v3a.5.5 0 0 1-1 0V5c0-.28.22-.5.5-.5zm0 6a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z" />
        </svg>
        <span className="lace-error-banner__message">Terraform validation failed</span>
        <button
          type="button"
          className="lace-error-banner__view-details"
          onClick={() => setDialogOpen(true)}
        >
          View details
        </button>
        <button
          type="button"
          className="lace-error-banner__dismiss"
          onClick={onDismiss}
          title="Dismiss"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>

      {dialogOpen && (
        <ValidationErrorDialog
          diagnostics={diagnostics}
          nodeIds={nodeIds}
          onGoToNode={(nodeId) => {
            setDialogOpen(false);
            onGoToNode(nodeId);
          }}
          onOpenFile={(relativePath, line, column) => {
            setDialogOpen(false);
            onOpenFile(relativePath, line, column);
          }}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract a canvas node ID from a Terraform diagnostic.
 * Tries instance_id first, then address field, then file path.
 */
function extractNodeId(
  d: { instance_id?: string; address?: string; file?: string },
  nodeIds: Set<string>,
): string | null {
  if (d.instance_id && nodeIds.has(d.instance_id)) return d.instance_id;
  if (d.address) {
    const m = d.address.match(/^module\.([^.]+)/);
    if (m && nodeIds.has(m[1])) return m[1];
  }
  if (d.file) {
    const m = d.file.match(/(?:^|[\\/])modules[\\/]([^/\\]+)[\\/]/);
    if (m && nodeIds.has(m[1])) return m[1];
  }
  return null;
}
