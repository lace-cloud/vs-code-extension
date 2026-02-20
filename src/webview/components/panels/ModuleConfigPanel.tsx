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
/* Shared Tailwind class strings      */
/* ---------------------------------- */

const inputClasses =
  'w-full bg-[#0f0f0f] text-white border border-[#333] rounded-lg px-2.5 py-2.5 text-xs';

const selectClasses = inputClasses;

const miniBtnClasses =
  'w-[34px] rounded-lg border border-[#333] bg-[#0f0f0f] text-white cursor-pointer';

const addBtnClasses =
  'rounded-lg border border-dashed border-[#444] bg-[#0f0f0f] text-white px-2.5 py-2.5 cursor-pointer text-xs text-left';

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
      <header className="p-4 border-b border-[#333] flex justify-between items-center shrink-0">
        <div className="flex flex-col gap-1">
          <div className="text-xs opacity-70">Module</div>
          <h3 className="m-0 text-base">{title}</h3>
        </div>

        <button
          onClick={onClose}
          className="cursor-pointer border border-[#333] bg-[#0f0f0f] text-white rounded-lg w-[34px] h-[34px]"
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>
      </header>

      {/* ---------- BODY ---------- */}
      <div className="flex-1 overflow-y-auto p-4 pb-24">
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
              className={`flex items-center justify-between ${requiredInputs.length > 0 ? 'mt-4.5' : ''}`}
            >
              <SectionTitle label="Optional Inputs" className="mb-0" />

              <button
                onClick={() => setShowOptional((v) => !v)}
                className="cursor-pointer border border-[#333] bg-[#0f0f0f] text-white rounded-full px-2.5 py-1.5 text-xs opacity-90"
              >
                {showOptional ? 'Hide' : 'Show'} ({optionalCount})
              </button>
            </div>

            <div className="h-2.5" />

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
                className="mb-2.5 text-xs opacity-85 bg-[#0f0f0f] border border-[#333] rounded-[10px] px-2.5 py-2.5"
              >
                <div className="flex justify-between gap-2.5">
                  <strong className="text-xs">{o.name}</strong>
                  <span className="font-mono opacity-75 text-[11px]">{o.type ?? ''}</span>
                </div>
                {o.description && (
                  <div className="mt-1.5 text-[11px] opacity-70">{o.description}</div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* ---------- FOOTER ---------- */}
      <footer className="p-4 border-t border-[#333] bg-[#1e1e1e] sticky bottom-0 z-30">
        <button
          className="w-full py-3 bg-[#1f6feb] text-white border-none rounded-[10px] font-bold text-sm cursor-pointer"
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
  className = '',
}: {
  label: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <h4
      className={`m-0 mb-3 text-[13px] font-bold uppercase tracking-wide opacity-85 ${className}`}
      style={style}
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
      <div className="flex gap-2 items-center">
        <input value={wiredValue} readOnly className={`${inputClasses} font-mono opacity-95`} />
        <span className="text-[11px] px-2.5 py-1.5 rounded-full border border-[#2b4a7a] bg-[#0b1f3a] text-[#9ecbff] font-bold whitespace-nowrap">
          Wired
        </span>
      </div>,
    );
  }

  if (type === 'string') {
    return field(
      input,
      <input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={inputClasses}
      />,
    );
  }

  if (type === 'number') {
    return field(
      input,
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className={inputClasses}
      />,
    );
  }

  if (type === 'bool') {
    return field(
      input,
      <select
        value={String(value ?? false)}
        onChange={(e) => onChange(e.target.value === 'true')}
        className={selectClasses}
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
      <div className="flex flex-col gap-2">
        {items.map((v: any, idx: number) => (
          <div key={idx} className="flex gap-2">
            <input
              value={v ?? ''}
              onChange={(e) => {
                const copy = [...items];
                copy[idx] = e.target.value;
                onChange(copy);
              }}
              className={`${inputClasses} flex-1`}
            />
            <button
              onClick={() => onChange(items.filter((_: any, i: number) => i !== idx))}
              className={miniBtnClasses}
              title="Remove"
            >
              −
            </button>
          </div>
        ))}
        <button onClick={() => onChange([...items, ''])} className={addBtnClasses}>
          + Add
        </button>
      </div>,
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
      <div className="flex flex-col gap-2">
        {Object.entries(mapVal).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <input value={k} disabled className={`${inputClasses} flex-1 opacity-70`} />
            <input
              value={v as string}
              onChange={(e) => onChange({ ...mapVal, [k]: e.target.value })}
              className={`${inputClasses} flex-2`}
            />
            <button
              onClick={() => {
                const copy = { ...mapVal };
                delete copy[k];
                onChange(copy);
              }}
              className={miniBtnClasses}
              title="Remove"
            >
              −
            </button>
          </div>
        ))}
        <button
          onClick={() => onChange({ ...mapVal, [`key_${Date.now()}`]: '' })}
          className={addBtnClasses}
        >
          + Add
        </button>
      </div>,
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
    <div className="mb-4 flex flex-col gap-1.5">
      <label className="text-xs font-semibold opacity-90">
        {input.name}
        {input.required && <span className="text-[#e5484d] ml-1">*</span>}
      </label>

      {body}

      {input.description && <div className="text-[11px] opacity-60">{input.description}</div>}
    </div>
  );
}
