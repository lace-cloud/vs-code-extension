// src/webview/components/panels/EdgeConfigPanel.tsx
import React, { useMemo, useState, useEffect } from 'react';
import type { EdgeConfig, RenderOutput, RenderInput } from '../../types/render';
import type { CanvasEngine } from '../../engine';
import { inputClasses } from '../../styles/panel';
import PanelFrame from '../PanelFrame';

type Props = {
  source_instance: string;
  target_instance: string;
  engine: CanvasEngine;
  onConnect: (source: string, target: string, outputName: string, inputName: string) => void;
  onClose: () => void;
};

export default function EdgeConfigPanel({
  source_instance,
  target_instance,
  engine,
  onConnect,
  onClose,
}: Props) {
  const [edgeConfig, setEdgeConfig] = useState<EdgeConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch edge config from engine
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    engine.queryEdgeConfig(source_instance, target_instance).then((result) => {
      if (cancelled) return;
      setEdgeConfig(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [source_instance, target_instance, engine]);

  const outputs = edgeConfig?.source_outputs ?? [];
  const unboundInputs = edgeConfig?.target_unbound_inputs ?? [];

  // Required inputs first
  const sortedInputs = useMemo(() => {
    const req = unboundInputs.filter((i: RenderInput) => i.required);
    const opt = unboundInputs.filter((i: RenderInput) => !i.required);
    return [...req, ...opt];
  }, [unboundInputs]);

  const defaultFrom = outputs[0]?.name ?? '';
  const defaultTo = sortedInputs[0]?.name ?? '';

  const [from, setFrom] = useState<string>(defaultFrom);
  const [to, setTo] = useState<string>(defaultTo);

  // Update defaults when config loads
  useEffect(() => {
    if (outputs.length > 0 && !from) setFrom(outputs[0].name);
    if (sortedInputs.length > 0 && !to) setTo(sortedInputs[0].name);
  }, [outputs, sortedInputs, from, to]);

  if (loading || !edgeConfig) {
    return (
      <PanelFrame title="Loading..." width={460} onClose={onClose}>
        <div className="text-xs opacity-60">Loading connection config...</div>
      </PanelFrame>
    );
  }

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
      onClick={() => onConnect(source_instance, target_instance, from, to)}
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
            {outputs.map((o: RenderOutput) => (
              <option key={o.name} value={o.name}>
                {o.name}
                {o.type ? ` : ${o.type}` : ''}
              </option>
            ))}
          </select>
          <div className="text-[11px] opacity-60 mt-1.5">
            {outputs.find((o: RenderOutput) => o.name === from)?.description ?? ''}
          </div>
        </div>

        {/* To input */}
        <div className="flex-1">
          <label className="block text-xs font-medium opacity-90 mb-1.5">To Input</label>
          <select value={to} onChange={(e) => setTo(e.target.value)} className={inputClasses}>
            {sortedInputs.map((i: RenderInput) => (
              <option key={i.name} value={i.name}>
                {i.required ? '* ' : ''}
                {i.name}
                {i.type ? ` : ${i.type}` : ''}
              </option>
            ))}
          </select>
          <div className="text-[11px] opacity-60 mt-1.5">
            {sortedInputs.find((i: RenderInput) => i.name === to)?.description ?? ''}
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
