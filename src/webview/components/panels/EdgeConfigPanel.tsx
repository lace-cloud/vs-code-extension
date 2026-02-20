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
    <div className="absolute right-0 top-0 w-[460px] h-full bg-[#1e1e1e] border-l border-[#333] flex flex-col z-40">
      {/* header */}
      <header className="p-4 border-b border-[#333] flex justify-between items-center shrink-0">
        <div>
          <div className="text-xs opacity-70">{title}</div>
          <div className="text-sm font-semibold mt-0.5">
            {fromLabel} → {toLabel}
          </div>
        </div>
        <button onClick={onClose} className="cursor-pointer">
          ✕
        </button>
      </header>

      {/* body */}
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        <SectionTitle label="Map output to input" />

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium opacity-90 mb-1.5">From Output</label>
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full bg-[#0f0f0f] text-white border border-[#333] rounded-lg px-2.5 py-2.5 text-xs"
            >
              {fromOutputs.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.name}
                  {o.type ? ` : ${o.type}` : ''}
                </option>
              ))}
            </select>
            <div className="text-[11px] opacity-60 mt-1.5">{descFor(fromOutputs, from)}</div>
          </div>

          <div className="flex-1">
            <label className="block text-xs font-medium opacity-90 mb-1.5">To Input</label>
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full bg-[#0f0f0f] text-white border border-[#333] rounded-lg px-2.5 py-2.5 text-xs"
            >
              {requiredFirst.map((i) => (
                <option key={i.name} value={i.name}>
                  {i.required ? '★ ' : ''}
                  {i.name}
                  {i.type ? ` : ${i.type}` : ''}
                </option>
              ))}
            </select>
            <div className="text-[11px] opacity-60 mt-1.5">{descFor(requiredFirst, to)}</div>
          </div>
        </div>

        <div className="mt-4.5 text-xs opacity-80">
          This will generate:
          <div className="mt-1.5 font-mono text-[11px] opacity-90">
            wires: from {`outputs.${from}`} → to {`inputs.${to}`}
          </div>
        </div>
      </div>

      {/* footer */}
      <footer className="p-4 border-t border-[#333] bg-[#1e1e1e] sticky bottom-0 z-50">
        <button
          className="w-full py-3 bg-[#1f6feb] text-white border-none rounded-lg font-semibold text-sm cursor-pointer"
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
    <h4 className="m-0 mb-3 text-[13px] font-semibold uppercase tracking-wide opacity-85">
      {label}
    </h4>
  );
}

function descFor(list: any[], name: string) {
  const found = (list || []).find((x) => x?.name === name);
  return found?.description || '';
}
