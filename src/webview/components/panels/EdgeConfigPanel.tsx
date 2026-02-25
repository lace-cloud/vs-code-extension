// src/webview/components/panels/EdgeConfigPanel.tsx
import React, { useMemo, useState } from 'react';
import type { InputDef, OutputDef, Binding } from '../../types/ir';
import { isOut } from '../../types/ir';
import { inputClasses } from '../../styles/panel';
import PanelFrame from '../PanelFrame';

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

  const title = (
    <div>
      <div className="text-xs opacity-70">Connection</div>
      <div className="text-sm font-semibold mt-0.5">
        {source_instance} → {target_instance}
      </div>
    </div>
  );

  const footer = (
    <button
      className="w-full py-3 bg-[#1f6feb] text-white border-none rounded-lg font-semibold text-sm cursor-pointer"
      disabled={!from || !to}
      onClick={() => onConnect({ from, to })}
    >
      Save connection
    </button>
  );

  return (
    <PanelFrame title={title} width={460} footer={footer} onClose={onClose}>
      <h4 className="m-0 mb-3 text-[13px] font-semibold uppercase tracking-wide opacity-85">
        Map output to input
      </h4>

      <div className="flex gap-3">
        {/* From output */}
        <div className="flex-1">
          <label className="block text-xs font-medium opacity-90 mb-1.5">From Output</label>
          <select value={from} onChange={(e) => setFrom(e.target.value)} className={inputClasses}>
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
          <select value={to} onChange={(e) => setTo(e.target.value)} className={inputClasses}>
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
    </PanelFrame>
  );
}
