import React, { useState, useMemo } from 'react';

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
  onSave,
  onClose,
}: Props) {
  const [values, setValues] = useState<Record<string, any>>(initialValues ?? {});
  const [showOptional, setShowOptional] = useState(false);

  const updateValue = (key: string, value: any) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  /* ---------- Split Inputs ---------- */

  const { requiredInputs, optionalInputs } = useMemo(() => {
    return {
      requiredInputs: inputs.filter((i) => i.required),
      optionalInputs: inputs.filter((i) => !i.required),
    };
  }, [inputs]);

  return (
    <div
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        width: 420,
        height: '100%',
        background: '#1e1e1e',
        borderLeft: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20,
      }}
    >
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
        <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
        <button onClick={onClose}>✕</button>
      </header>

      {/* ---------- BODY ---------- */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          paddingBottom: 96,
        }}
      >
        {/* ---------- REQUIRED INPUTS ---------- */}
        {requiredInputs.length > 0 && (
          <>
            <SectionTitle label="Required Inputs" />

            {requiredInputs.map((input) =>
              renderInput({
                input,
                value: values[input.name],
                onChange: (v) => updateValue(input.name, v),
              })
            )}
          </>
        )}

        {/* ---------- OPTIONAL INPUTS ---------- */}
        {optionalInputs.length > 0 && (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 24,
                marginBottom: 8,
              }}
            >
              <SectionTitle label="Optional Inputs" />
              <button
                style={{
                  fontSize: 12,
                  opacity: 0.8,
                }}
                onClick={() => setShowOptional((v) => !v)}
              >
                {showOptional ? 'Hide' : 'Show'}
              </button>
            </div>

            {showOptional &&
              optionalInputs.map((input) =>
                renderInput({
                  input,
                  value: values[input.name],
                  onChange: (v) => updateValue(input.name, v),
                })
              )}
          </>
        )}

        {/* ---------- OUTPUTS ---------- */}
        {outputs.length > 0 && (
          <>
            <SectionTitle label="Outputs" style={{ marginTop: 32 }} />

            {outputs.map((o) => (
              <div
                key={o.name}
                style={{
                  marginBottom: 10,
                  fontSize: 12,
                  opacity: 0.7,
                }}
              >
                <strong>{o.name}</strong>
                {o.description && (
                  <div style={{ marginTop: 2 }}>{o.description}</div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* ---------- FOOTER ---------- */}
      <footer
        style={{
          padding: 16,
          borderTop: '1px solid #333',
          background: '#1e1e1e',
          position: 'sticky',
          bottom: 0,
          zIndex: 30,
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

function SectionTitle({
  label,
  style = {},
}: {
  label: string;
  style?: React.CSSProperties;
}) {
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
        ...style,
      }}
    >
      {label}
    </h4>
  );
}

/* ---------------------------------- */
/* Input Renderer (UNCHANGED)         */
/* ---------------------------------- */

function renderInput({
  input,
  value,
  onChange,
}: {
  input: TerraformInput;
  value: any;
  onChange: (v: any) => void;
}): JSX.Element | null {
  const type = input.type;

  if (type === 'string') {
    return field(
      input,
      <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    );
  }

  if (type === 'number') {
    return field(
      input,
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  }

  if (type === 'bool') {
    return field(
      input,
      <select
        value={String(value ?? false)}
        onChange={(e) => onChange(e.target.value === 'true')}
      >
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }

  if (type.startsWith('list(')) {
    const items = value ?? [];
    return field(
      input,
      <>
        {items.map((v: any, idx: number) => (
          <div key={idx} style={{ display: 'flex', gap: 6 }}>
            <input
              value={v}
              onChange={(e) => {
                const copy = [...items];
                copy[idx] = e.target.value;
                onChange(copy);
              }}
            />
            <button
              onClick={() =>
                onChange(items.filter((_: any, i: number) => i !== idx))
              }
            >
              −
            </button>
          </div>
        ))}
        <button onClick={() => onChange([...items, ''])}>+ Add</button>
      </>
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
      <>
        {Object.entries(mapVal).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 6 }}>
            <input value={k} disabled />
            <input
              value={v as string}
              onChange={(e) =>
                onChange({ ...mapVal, [k]: e.target.value })
              }
            />
            <button
              onClick={() => {
                const copy = { ...mapVal };
                delete copy[k];
                onChange(copy);
              }}
            >
              −
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            onChange({ ...mapVal, [`key_${Date.now()}`]: '' })
          }
        >
          + Add
        </button>
      </>
    );
  }

  if (type === 'object' && input.object) {
    const objVal = value ?? {};
    return field(
      input,
      <fieldset style={{ paddingLeft: 12, borderLeft: '2px solid #333' }}>
        {Object.entries(input.object).map(([key, def]) =>
          renderInput({
            input: { ...def, name: key },
            value: objVal[key],
            onChange: (v) => onChange({ ...objVal, [key]: v }),
          })
        )}
      </fieldset>
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
          })
        )}
      </>
    );
  }

  return null;
}

/* ---------------------------------- */
/* Field Wrapper                      */
/* ---------------------------------- */

function field(input: TerraformInput, body: React.ReactNode) {
  return (
    <div
      style={{
        marginBottom: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <label
        style={{
          fontSize: 12,
          fontWeight: 500,
          opacity: 0.9,
        }}
      >
        {input.name}
        {input.required && (
          <span style={{ color: '#e5484d', marginLeft: 4 }}>*</span>
        )}
      </label>

      {body}

      {input.description && (
        <div style={{ fontSize: 11, opacity: 0.6 }}>
          {input.description}
        </div>
      )}
    </div>
  );
}
