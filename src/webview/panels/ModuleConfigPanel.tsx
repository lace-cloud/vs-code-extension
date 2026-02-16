// src/webview/components/panels/ModuleConfigPanel.tsx
import React, { useMemo, useState } from 'react';

/* ---------------------------------- */
/* Types                              */
/* ---------------------------------- */

type TerraformInput = {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  default?: any;
  object?: Record<string, TerraformInput>;
  tuple?: TerraformInput[];
};

type TerraformOutput = {
  name: string;
  description?: string;
  type?: string;
};

type Props = {
  title: string;
  inputs: TerraformInput[];
  outputs?: TerraformOutput[];
  initialValues: Record<string, any>;
  wiredInputs?: Record<string, string>; // inputName -> "module.x.y"
  onSave: (values: Record<string, any>) => void;
  onClose: () => void;
};

/* ---------------------------------- */
/* Component                          */
/* ---------------------------------- */

export default function ModuleConfigPanel({
  title,
  inputs,
  outputs = [],
  initialValues,
  wiredInputs = {},
  onSave,
  onClose,
}: Props) {
  const [values, setValues] = useState<Record<string, any>>(initialValues ?? {});
  const [showOptional, setShowOptional] = useState(true); // ✅ default show, so fields don't "disappear"

  const updateValue = (key: string, value: any) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  /* ---------- Split Inputs ---------- */

  const { requiredInputs, optionalInputs } = useMemo(() => {
    return {
      requiredInputs: (inputs ?? []).filter((i) => i.required),
      optionalInputs: (inputs ?? []).filter((i) => !i.required),
    };
  }, [inputs]);

  const optionalCount = optionalInputs.length;

  return (
    <div className="absolute right-0 top-0 w-[420px] h-full bg-[#1e1e1e] border-l border-[#333] flex flex-col z-20">
      {/* ---------- HEADER ---------- */}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Module</div>
          <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
        </div>

        <button
          onClick={onClose}
          style={{
            cursor: 'pointer',
            border: '1px solid #333',
            background: '#0f0f0f',
            color: '#fff',
            borderRadius: 8,
            width: 34,
            height: 34,
          }}
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>
      </header>

      {/* ---------- BODY ---------- */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, paddingBottom: 96 }}>
        {/* ---------- REQUIRED INPUTS ---------- */}
        {requiredInputs.length > 0 && (
          <>
            <SectionTitle label="Required Inputs" />
            {requiredInputs.map((input) =>
              renderInput({
                input,
                value: values[input.name],
                wiredValue: wiredInputs?.[input.name],
                onChange: (v) => updateValue(input.name, v),
              }),
            )}
          </>
        )}

        {/* ---------- OPTIONAL INPUTS ---------- */}
        {optionalInputs.length > 0 && (
          <>
            <div
              style={{
                marginTop: requiredInputs.length > 0 ? 18 : 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <SectionTitle label="Optional Inputs" style={{ marginBottom: 0 }} />

              <button
                onClick={() => setShowOptional((v) => !v)}
                style={{
                  cursor: 'pointer',
                  border: '1px solid #333',
                  background: '#0f0f0f',
                  color: '#fff',
                  borderRadius: 999,
                  padding: '6px 10px',
                  fontSize: 12,
                  opacity: 0.9,
                }}
              >
                {showOptional ? 'Hide' : 'Show'} ({optionalCount})
              </button>
            </div>

            <div style={{ height: 10 }} />

            {showOptional &&
              optionalInputs.map((input) =>
                renderInput({
                  input,
                  value: values[input.name],
                  wiredValue: wiredInputs?.[input.name],
                  onChange: (v) => updateValue(input.name, v),
                }),
              )}
          </>
        )}

        {/* ---------- OUTPUTS ---------- */}
        {outputs.length > 0 && (
          <>
            <SectionTitle label="Outputs" style={{ marginTop: 26 }} />
            {outputs.map((o) => (
              <div
                key={o.name}
                style={{
                  marginBottom: 10,
                  fontSize: 12,
                  opacity: 0.85,
                  background: '#0f0f0f',
                  border: '1px solid #333',
                  borderRadius: 10,
                  padding: '10px 10px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <strong style={{ fontSize: 12 }}>{o.name}</strong>
                  <span style={{ fontFamily: 'monospace', opacity: 0.75, fontSize: 11 }}>
                    {o.type ?? ''}
                  </span>
                </div>
                {o.description && <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>{o.description}</div>}
              </div>
            ))}
          </>
        )}
      </div>

      {/* ---------- FOOTER ---------- */}
      <footer className="p-4 border-t border-[#333] bg-[#1e1e1e] sticky bottom-0 z-30">
        <button
          style={{
            width: '100%',
            padding: '12px 0',
            background: '#1f6feb',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
          }}
          onClick={() => onSave(values)}
        >
          Save configuration
        </button>
      </footer>
    </div>
  );
}

/* ---------------------------------- */
/* Section Title                      */
/* ---------------------------------- */

function SectionTitle({ label, style = {} }: { label: string; style?: React.CSSProperties }) {
  return (
    <h4
      style={{
        margin: 0,
        marginBottom: 12,
        fontSize: 13,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        opacity: 0.85,
        ...style,
      }}
    >
      {label}
    </h4>
  );
}

/* ---------------------------------- */
/* Input Renderer                     */
/* ---------------------------------- */

function renderInput({
  input,
  value,
  onChange,
  wiredValue,
}: {
  input: TerraformInput;
  value: any;
  onChange: (v: any) => void;
  wiredValue?: string;
}): JSX.Element | null {
  const type = input.type || 'string';

  // ✅ If wired, show read-only Terraform expression (module.x.y)
  if (wiredValue) {
    return field(
      input,
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={wiredValue}
          readOnly
          style={{
            width: '100%',
            background: '#0f0f0f',
            color: '#fff',
            border: '1px solid #333',
            borderRadius: 8,
            padding: '10px 10px',
            fontSize: 12,
            fontFamily: 'monospace',
            opacity: 0.95,
          }}
        />
        <span
          style={{
            fontSize: 11,
            padding: '6px 10px',
            borderRadius: 999,
            border: '1px solid #2b4a7a',
            background: '#0b1f3a',
            color: '#9ecbff',
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          Wired
        </span>
      </div>
    );
  }

  if (type === 'string') {
    return field(
      input,
      <input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    );
  }

  if (type === 'number') {
    return field(
      input,
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        style={inputStyle}
      />
    );
  }

  if (type === 'bool') {
    return field(
      input,
      <select
        value={String(value ?? false)}
        onChange={(e) => onChange(e.target.value === 'true')}
        style={selectStyle}
      >
        <option value="true">True</option>
        <option value="false">False</option>
      </select>,
    );
  }

  if (type.startsWith('list(')) {
    const items = Array.isArray(value) ? value : [];
    return field(
      input,
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((v: any, idx: number) => (
          <div key={idx} style={{ display: 'flex', gap: 8 }}>
            <input
              value={v ?? ''}
              onChange={(e) => {
                const copy = [...items];
                copy[idx] = e.target.value;
                onChange(copy);
              }}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={() => onChange(items.filter((_: any, i: number) => i !== idx))}
              style={miniBtnStyle}
              title="Remove"
            >
              −
            </button>
          </div>
        ))}
        <button onClick={() => onChange([...items, ''])} style={addBtnStyle}>
          + Add
        </button>
      </div>
    );
  }

  if (type.startsWith('set(')) {
    return renderInput({
      input: { ...input, type: 'list(string)' },
      value: Array.from(new Set(value ?? [])),
      onChange: (v) => onChange(Array.from(new Set(v))),
    });
  }

  if (type.startsWith('map(')) {
    const mapVal = value ?? {};
    return field(
      input,
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Object.entries(mapVal).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 8 }}>
            <input value={k} disabled style={{ ...inputStyle, flex: 1, opacity: 0.7 }} />
            <input
              value={v as string}
              onChange={(e) => onChange({ ...mapVal, [k]: e.target.value })}
              style={{ ...inputStyle, flex: 2 }}
            />
            <button
              onClick={() => {
                const copy = { ...mapVal };
                delete copy[k];
                onChange(copy);
              }}
              style={miniBtnStyle}
              title="Remove"
            >
              −
            </button>
          </div>
        ))}
        <button
          onClick={() => onChange({ ...mapVal, [`key_${Date.now()}`]: '' })}
          style={addBtnStyle}
        >
          + Add
        </button>
      </div>
    );
  }

  if (type === 'object' && input.object) {
    const objVal = value ?? {};
    return field(
      input,
      <fieldset className="pl-3 border-l-2 border-[#333]">
        {Object.entries(input.object).map(([key, def]) =>
          renderInput({
            input: { ...def, name: key },
            value: objVal[key],
            onChange: (v) => onChange({ ...objVal, [key]: v }),
          }),
        )}
      </fieldset>,
    );
  }

  if (type === 'tuple' && input.tuple) {
    const tupleVal = value ?? [];
    return field(
      input,
      <>
        {input.tuple.map((t, idx: number) =>
          renderInput({
            input: { ...t, name: `${input.name}[${idx}]` },
            value: tupleVal[idx],
            onChange: (v) => {
              const copy = [...tupleVal];
              copy[idx] = v;
              onChange(copy);
            },
          }),
        )}
      </>,
    );
  }

  return null;
}

/* ---------------------------------- */
/* Field Wrapper                      */
/* ---------------------------------- */

function field(input: TerraformInput, body: React.ReactNode) {
  return (
    <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 600, opacity: 0.9 }}>
        {input.name}
        {input.required && <span className="text-[#e5484d] ml-1">*</span>}
      </label>

      {body}

      {input.description && <div className="text-[11px] opacity-60">{input.description}</div>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0f0f0f',
  color: '#fff',
  border: '1px solid #333',
  borderRadius: 8,
  padding: '10px 10px',
  fontSize: 12,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  padding: '10px 10px',
};

const miniBtnStyle: React.CSSProperties = {
  width: 34,
  borderRadius: 8,
  border: '1px solid #333',
  background: '#0f0f0f',
  color: '#fff',
  cursor: 'pointer',
};

const addBtnStyle: React.CSSProperties = {
  borderRadius: 8,
  border: '1px dashed #444',
  background: '#0f0f0f',
  color: '#fff',
  padding: '10px 10px',
  cursor: 'pointer',
  fontSize: 12,
  textAlign: 'left',
};
