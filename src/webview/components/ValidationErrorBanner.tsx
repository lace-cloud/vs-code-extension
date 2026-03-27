import React, { useState } from 'react';
import type { Diagnostic } from '../../types/protocol';

// ── ValidationErrorDialog ──────────────────────────────────────────────────

type DialogProps = {
  diagnostics: Diagnostic[];
  nodeIds: Set<string>;
  onGoToNode: (nodeId: string) => void;
  onSolveWithLace: () => void;
  onClose: () => void;
};

function ValidationErrorDialog({
  diagnostics,
  nodeIds,
  onGoToNode,
  onSolveWithLace,
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
            const nodeId = d.file ? extractNodeId(d.file, nodeIds) : null;
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
                {(d.file || d.line != null) && (
                  <div style={{ color: '#888', fontSize: 10, marginBottom: nodeId ? 6 : 0 }}>
                    {d.file && <span>{d.file}</span>}
                    {d.line != null && <span>:{d.line}</span>}
                    {d.column != null && <span>:{d.column}</span>}
                  </div>
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
                    Go to node
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer — Solve with Lace (progressive disclosure: only visible here) */}
        <div
          className="px-4 py-3 flex justify-end"
          style={{ borderTop: '1px solid rgba(229,72,77,0.2)' }}
        >
          <button
            onClick={onSolveWithLace}
            style={{
              fontSize: 12,
              color: '#CEFE65',
              background: 'rgba(206,254,101,0.1)',
              border: '1px solid rgba(206,254,101,0.3)',
              borderRadius: 5,
              padding: '5px 14px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Solve with Lace
          </button>
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
  onSolveWithLace: () => void;
  onDismiss: () => void;
};

export function ValidationErrorBanner({
  diagnostics,
  nodeIds,
  onGoToNode,
  onSolveWithLace,
  onDismiss,
}: BannerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (diagnostics.length === 0) return null;

  return (
    <>
      {/* Persistent banner — same top-left position as toast */}
      <div
        className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-md text-xs shadow-[0_2px_6px_rgba(0,0,0,0.3)] border"
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
          onSolveWithLace={() => {
            setDialogOpen(false);
            onSolveWithLace();
          }}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Terraform reports file paths like "module.cluster" or filenames like "main.tf".
 * We try to match a node ID from the diagnostic file string.
 * The convention is: a diagnostic file of "module.<instanceId>" maps to instanceId.
 */
function extractNodeId(file: string, nodeIds: Set<string>): string | null {
  // Direct match first
  if (nodeIds.has(file)) return file;

  // "module.foo" → "foo"
  const moduleMatch = file.match(/^module\.([^.]+)/);
  if (moduleMatch && nodeIds.has(moduleMatch[1])) return moduleMatch[1];

  return null;
}
