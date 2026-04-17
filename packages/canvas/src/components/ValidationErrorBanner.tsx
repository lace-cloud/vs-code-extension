import { useState } from 'react';
import type { Diagnostic } from '../types/render';

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
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="relative rounded-lg shadow-2xl"
        style={{
          background: '#1a1a1a',
          border: '1px solid rgba(229,72,77,0.35)',
          width: 520,
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid rgba(229,72,77,0.2)' }}
        >
          <span style={{ color: '#f87171', fontSize: 13, fontWeight: 600 }}>
            Terraform Validation Errors ({diagnostics.length})
          </span>
          <button
            onClick={onClose}
            style={{
              color: '#888',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
            }}
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Error list */}
        <div
          className="overflow-y-auto flex-1 px-4 py-3"
          style={{ gap: 10, display: 'flex', flexDirection: 'column' }}
        >
          {diagnostics.map((d, i) => {
            const nodeId = extractNodeId(d, nodeIds);
            const hasFileLink = !!d.file;
            return (
              <div
                key={i}
                style={{
                  background: '#2a1414',
                  border: '1px solid rgba(229,72,77,0.2)',
                  borderRadius: 6,
                  padding: '8px 10px',
                }}
              >
                <div style={{ color: '#f87171', fontSize: 12, marginBottom: 4 }}>{d.message}</div>
                {hasFileLink && (
                  <button
                    onClick={() => onOpenFile(d.file!, d.line, d.column)}
                    title="Open file in editor"
                    style={{
                      display: 'block',
                      color: '#888',
                      fontSize: 10,
                      marginBottom: nodeId ? 6 : 0,
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      textAlign: 'left',
                      textDecoration: 'underline',
                      textDecorationColor: 'rgba(136,136,136,0.4)',
                    }}
                  >
                    {d.file}
                    {d.line != null && `:${d.line}`}
                    {d.column != null && `:${d.column}`}
                  </button>
                )}
                {nodeId && (
                  <button
                    onClick={() => onGoToNode(nodeId)}
                    style={{
                      fontSize: 10,
                      color: '#CEFE65',
                      background: 'rgba(206,254,101,0.08)',
                      border: '1px solid rgba(206,254,101,0.25)',
                      borderRadius: 4,
                      padding: '2px 8px',
                      cursor: 'pointer',
                    }}
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
      {/* Persistent banner — top-right, below the ActionBar. Matches Toast's
          60px/16px offset so banner and toast visually align. */}
      <div
        className="absolute top-[60px] right-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-md text-xs shadow-[0_2px_6px_rgba(0,0,0,0.3)] border"
        style={{
          background: '#3a1518',
          color: '#f87171',
          borderColor: 'rgba(248,113,113,0.3)',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="#f87171" style={{ flexShrink: 0 }}>
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 3.5c.28 0 .5.22.5.5v3a.5.5 0 0 1-1 0V5c0-.28.22-.5.5-.5zm0 6a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z" />
        </svg>
        <span>Terraform validation failed</span>
        <button
          onClick={() => setDialogOpen(true)}
          style={{
            color: '#f87171',
            background: 'rgba(248,113,113,0.12)',
            border: '1px solid rgba(248,113,113,0.3)',
            borderRadius: 4,
            padding: '1px 7px',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          View details
        </button>
        <button
          onClick={onDismiss}
          style={{
            color: '#888',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
            padding: '0 2px',
          }}
          title="Dismiss"
        >
          ×
        </button>
      </div>

      {/* Dialog — only mounts when opened */}
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
