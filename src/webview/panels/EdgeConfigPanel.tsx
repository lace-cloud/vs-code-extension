// src/webview/components/panels/EdgeConfigPanel.tsx
import React, { useMemo, useState } from 'react';

type Port = {
  name: string;
  type?: string;
  description?: string;
};

type Props = {
  title: string;
  fromLabel: string;
  toLabel: string;
  fromOutputs: Port[];
  toInputs: (Port & { required?: boolean })[];
  initial?: { from?: string; to?: string };
  onSave: (mapping: { from: string; to: string }) => void;
  onClose: () => void;
};

export default function EdgeConfigPanel({
  title,
  fromLabel,
  toLabel,
  fromOutputs,
  toInputs,
  initial,
  onSave,
  onClose,
}: Props) {
  const defaultFrom = initial?.from ?? fromOutputs?.[0]?.name ?? '';
  const defaultTo = initial?.to ?? toInputs?.[0]?.name ?? '';

  const [from, setFrom] = useState<string>(defaultFrom);
  const [to, setTo] = useState<string>(defaultTo);

  const requiredFirst = useMemo(() => {
    const req = (toInputs || []).filter((i) => i.required);
    const opt = (toInputs || []).filter((i) => !i.required);
    return [...req, ...opt];
  }, [toInputs]);

  return (
    <div
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        width: 460,
        height: '100%',
        background: '#1e1e1e',
        borderLeft: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
      }}
    >
      {/* header */}
      <header
        style={{
          padding: 16,
          borderBottom: '1px solid #333',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{title}</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
            {fromLabel} → {toLabel}
          </div>
        </div>
        <button onClick={onClose} style={{ cursor: 'pointer' }}>
          ✕
        </button>
      </header>

      {/* body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, paddingBottom: 96 }}>
        <SectionTitle label="Map output to input" />

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>From Output</label>
            <select value={from} onChange={(e) => setFrom(e.target.value)} style={selectStyle}>
              {fromOutputs.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.name}{o.type ? ` : ${o.type}` : ''}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
              {descFor(fromOutputs, from)}
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <label style={labelStyle}>To Input</label>
            <select value={to} onChange={(e) => setTo(e.target.value)} style={selectStyle}>
              {requiredFirst.map((i) => (
                <option key={i.name} value={i.name}>
                  {i.required ? '★ ' : ''}
                  {i.name}{i.type ? ` : ${i.type}` : ''}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
              {descFor(requiredFirst, to)}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 18, fontSize: 12, opacity: 0.8 }}>
          This will generate:
          <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 11, opacity: 0.9 }}>
            wires: from {`outputs.${from}`} → to {`inputs.${to}`}
          </div>
        </div>
      </div>

      {/* footer */}
      <footer
        style={{
          padding: 16,
          borderTop: '1px solid #333',
          background: '#1e1e1e',
          position: 'sticky',
          bottom: 0,
          zIndex: 50,
        }}
      >
        <button
          style={{
            width: '100%',
            padding: '12px 0',
            background: '#1f6feb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
          }}
          disabled={!from || !to}
          onClick={() => onSave({ from, to })}
        >
          Save connection
        </button>
      </footer>
    </div>
  );
}

function SectionTitle({ label }: { label: string }) {
  return (
    <h4
      style={{
        margin: 0,
        marginBottom: 12,
        fontSize: 13,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        opacity: 0.85,
      }}
    >
      {label}
    </h4>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  opacity: 0.9,
  marginBottom: 6,
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: '#0f0f0f',
  color: '#fff',
  border: '1px solid #333',
  borderRadius: 8,
  padding: '10px 10px',
  fontSize: 12,
};

function descFor(list: any[], name: string) {
  const found = (list || []).find((x) => x?.name === name);
  return found?.description || '';
}
