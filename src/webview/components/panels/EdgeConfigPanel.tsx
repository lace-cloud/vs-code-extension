// src/webview/components/panels/EdgeConfigPanel.tsx
import React, { useMemo, useState } from 'react';
import type { InputDef, OutputDef, Binding } from '../../types/ir';
import { isOut } from '../../types/ir';

type Props = {
  source_instance: string;
  target_instance: string;
  source_schema: { inputs: InputDef[]; outputs: OutputDef[] };
  target_schema: { inputs: InputDef[]; outputs: OutputDef[] };
  target_inputs: Record<string, Binding>;
  onConnect: (mapping: { from: string; to: string }) => void;
  onClose: () => void;
};

export default function EdgeConfigPanel({
  source_instance,
  target_instance,
  source_schema,
  target_schema,
  target_inputs,
  onConnect,
  onClose,
}: Props) {
  const outputs = source_schema.outputs;

  // Only show unbound target inputs (not already wired via `out`)
  const unboundInputs = useMemo(() => {
    return target_schema.inputs.filter((inp) => {
      const binding = target_inputs[inp.name];
      return !binding || !isOut(binding);
    });
  }, [target_schema.inputs, target_inputs]);

  // Required inputs first
  const sortedInputs = useMemo(() => {
    const req = unboundInputs.filter((i) => i.required);
    const opt = unboundInputs.filter((i) => !i.required);
    return [...req, ...opt];
  }, [unboundInputs]);

  const defaultFrom = outputs[0]?.name ?? '';
  const defaultTo = sortedInputs[0]?.name ?? '';

  const [from, setFrom] = useState<string>(defaultFrom);
  const [to, setTo] = useState<string>(defaultTo);

  return (
    <div className="absolute right-0 top-0 w-[460px] h-full bg-[#1e1e1e] border-l border-[#333] flex flex-col z-40">
      {/* Header */}
      <header className="p-4 border-b border-[#333] flex justify-between items-center shrink-0">
        <div>
          <div className="text-xs opacity-70">Connection</div>
          <div className="text-sm font-semibold mt-0.5">
            {source_instance} → {target_instance}
          </div>
        </div>
        <button
          onClick={onClose}
          className="cursor-pointer border border-[#333] bg-[#0f0f0f] text-white rounded-lg w-[34px] h-[34px]"
        >
          ✕
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        <h4 className="m-0 mb-3 text-[13px] font-semibold uppercase tracking-wide opacity-85">
          Map output to input
        </h4>

        <div className="flex gap-3">
          {/* From output */}
          <div className="flex-1">
            <label className="block text-xs font-medium opacity-90 mb-1.5">From Output</label>
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full bg-[#0f0f0f] text-white border border-[#333] rounded-lg px-2.5 py-2.5 text-xs"
            >
              {outputs.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.name}
                  {o.type ? ` : ${o.type}` : ''}
                </option>
              ))}
            </select>
            <div className="text-[11px] opacity-60 mt-1.5">
              {outputs.find((o) => o.name === from)?.description ?? ''}
            </div>
          </div>

          {/* To input */}
          <div className="flex-1">
            <label className="block text-xs font-medium opacity-90 mb-1.5">To Input</label>
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full bg-[#0f0f0f] text-white border border-[#333] rounded-lg px-2.5 py-2.5 text-xs"
            >
              {sortedInputs.map((i) => (
                <option key={i.name} value={i.name}>
                  {i.required ? '★ ' : ''}
                  {i.name}
                  {i.type ? ` : ${i.type}` : ''}
                </option>
              ))}
            </select>
            <div className="text-[11px] opacity-60 mt-1.5">
              {sortedInputs.find((i) => i.name === to)?.description ?? ''}
            </div>
          </div>
        </div>

        <div className="mt-4 text-xs opacity-80">
          This will wire:
          <div className="mt-1.5 font-mono text-[11px] opacity-90">
            {source_instance}.outputs.{from} → {target_instance}.inputs.{to}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="p-4 border-t border-[#333] bg-[#1e1e1e] sticky bottom-0 z-50">
        <button
          className="w-full py-3 bg-[#1f6feb] text-white border-none rounded-lg font-semibold text-sm cursor-pointer"
          disabled={!from || !to}
          onClick={() => onConnect({ from, to })}
        >
          Save connection
        </button>
      </footer>
    </div>
  );
}
