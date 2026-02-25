// src/webview/components/panels/OutputsPanel.tsx
import React, { useState, useMemo, useCallback } from 'react';
import type { OutputDef, OutputExport, Instance } from '../../types/ir';
import { isOutExport } from '../../types/ir';
import type { ResolvedSchema } from '../../utils/resolve';

// ── Props ──

type Props = {
  instances: Instance[];
  /** Resolve schema for each instance (caller provides this) */
  resolveInstanceSchema: (inst: Instance) => ResolvedSchema;
  /** Current composite interface.outputs */
  output_defs: OutputDef[];
  /** Current impl.graph.exports.outputs */
  exports: Record<string, OutputExport>;
  onSave: (output_defs: OutputDef[], exports: Record<string, OutputExport>) => void;
  onClose: () => void;
};

// ── Available output from an instance ──

type AvailableOutput = {
  instance_id: string;
  output_name: string;
  type: string;
  description?: string;
};

// ── Selected export entry ──

type ExportEntry = {
  key: string; // The exported name
  instance_id: string;
  output_name: string;
  type: string;
  description: string;
  sensitive: boolean;
};

// ── Shared styles ──

const inputClasses =
  'w-full bg-[#0f0f0f] text-white border border-[#333] rounded-lg px-2.5 py-2 text-xs';

// ── Component ──

export default function OutputsPanel({
  instances,
  resolveInstanceSchema,
  output_defs,
  exports,
  onSave,
  onClose,
}: Props) {
  // ── Build list of all available outputs across all instances ──

  const available: AvailableOutput[] = useMemo(() => {
    const result: AvailableOutput[] = [];
    for (const inst of instances) {
      const schema = resolveInstanceSchema(inst);
      for (const out of schema.outputs) {
        result.push({
          instance_id: inst.id,
          output_name: out.name,
          type: out.type,
          description: out.description,
        });
      }
    }
    return result;
  }, [instances, resolveInstanceSchema]);

  // ── Initialize selected entries from current exports ──

  const [entries, setEntries] = useState<ExportEntry[]>(() => {
    const result: ExportEntry[] = [];
    for (const [key, exp] of Object.entries(exports)) {
      if (isOutExport(exp)) {
        // Find matching output_def for description/sensitive
        const def = output_defs.find((d) => d.name === key);
        // Find matching available output for type
        const avail = available.find(
          (a) => a.instance_id === exp.out.module && a.output_name === exp.out.name,
        );
        result.push({
          key,
          instance_id: exp.out.module,
          output_name: exp.out.name,
          type: avail?.type ?? def?.type ?? 'string',
          description: def?.description ?? '',
          sensitive: def?.sensitive ?? false,
        });
      }
    }
    return result;
  });

  // ── Track which available outputs are already selected ──

  const selectedSet = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) {
      s.add(`${e.instance_id}.${e.output_name}`);
    }
    return s;
  }, [entries]);

  // ── Toggle an available output ──

  const toggleOutput = useCallback(
    (avail: AvailableOutput) => {
      const lookupKey = `${avail.instance_id}.${avail.output_name}`;
      if (selectedSet.has(lookupKey)) {
        // Remove
        setEntries((prev) =>
          prev.filter(
            (e) => !(e.instance_id === avail.instance_id && e.output_name === avail.output_name),
          ),
        );
      } else {
        // Add with default export name
        const defaultKey = `${avail.output_name}`;
        // Ensure unique key
        let exportKey = defaultKey;
        const existingKeys = new Set(entries.map((e) => e.key));
        if (existingKeys.has(exportKey)) {
          exportKey = `${avail.instance_id}_${avail.output_name}`;
          let n = 1;
          while (existingKeys.has(exportKey)) {
            exportKey = `${avail.instance_id}_${avail.output_name}_${n}`;
            n++;
          }
        }
        setEntries((prev) => [
          ...prev,
          {
            key: exportKey,
            instance_id: avail.instance_id,
            output_name: avail.output_name,
            type: avail.type,
            description: avail.description ?? '',
            sensitive: false,
          },
        ]);
      }
    },
    [selectedSet, entries],
  );

  // ── Update entry fields ──

  const updateEntry = useCallback((idx: number, patch: Partial<ExportEntry>) => {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }, []);

  // ── Save ──

  const handleSave = useCallback(() => {
    const newExports: Record<string, OutputExport> = {};
    const newDefs: OutputDef[] = [];

    for (const entry of entries) {
      if (!entry.key.trim()) continue;
      newExports[entry.key] = {
        out: { module: entry.instance_id, name: entry.output_name },
      };
      newDefs.push({
        name: entry.key,
        type: entry.type,
        ...(entry.description ? { description: entry.description } : {}),
        ...(entry.sensitive ? { sensitive: true } : {}),
      });
    }

    onSave(newDefs, newExports);
  }, [entries, onSave]);

  // ── Group available by instance ──

  const groupedAvailable = useMemo(() => {
    const groups: Record<string, AvailableOutput[]> = {};
    for (const a of available) {
      if (!groups[a.instance_id]) groups[a.instance_id] = [];
      groups[a.instance_id].push(a);
    }
    return groups;
  }, [available]);

  return (
    <div className="w-[460px] h-full bg-[#1e1e1e] border-l border-[#333] flex flex-col">
      {/* Header */}
      <header className="p-4 border-b border-[#333] flex justify-between items-center shrink-0">
        <div className="flex flex-col gap-1">
          <div className="text-xs opacity-70">Composite</div>
          <h3 className="m-0 text-base">Outputs</h3>
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

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {/* Available outputs picker */}
        <h4 className="m-0 mb-3 text-[13px] font-bold uppercase tracking-wide opacity-85">
          Available Outputs
        </h4>

        {Object.keys(groupedAvailable).length === 0 && (
          <div className="text-xs opacity-60 text-center py-4">
            No instances have outputs to expose.
          </div>
        )}

        {Object.entries(groupedAvailable).map(([instId, outputs]) => (
          <div key={instId} className="mb-3">
            <div className="text-[11px] font-semibold opacity-70 mb-1.5">{instId}</div>
            {outputs.map((avail) => {
              const isSelected = selectedSet.has(`${avail.instance_id}.${avail.output_name}`);
              return (
                <label
                  key={`${avail.instance_id}.${avail.output_name}`}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg mb-1 cursor-pointer text-xs ${
                    isSelected
                      ? 'bg-[#1f6feb]/15 border border-[#1f6feb]/40'
                      : 'bg-[#0f0f0f] border border-[#333]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOutput(avail)}
                    className="accent-[#1f6feb]"
                  />
                  <span className="font-semibold">{avail.output_name}</span>
                  <span className="font-mono opacity-60 text-[11px] ml-auto">{avail.type}</span>
                </label>
              );
            })}
          </div>
        ))}

        {/* Selected exports configuration */}
        {entries.length > 0 && (
          <>
            <h4 className="m-0 mb-3 mt-5 text-[13px] font-bold uppercase tracking-wide opacity-85">
              Exported Outputs
            </h4>

            {entries.map((entry, idx) => (
              <div
                key={idx}
                className="mb-3 border border-[#333] rounded-lg bg-[#161616] p-3 flex flex-col gap-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] opacity-60 font-mono">
                    {entry.instance_id}.{entry.output_name}
                  </span>
                  <span className="text-[10px] opacity-50 ml-auto">→</span>
                </div>

                {/* Export name (renameable) */}
                <div>
                  <label className="block text-[11px] font-medium opacity-80 mb-1">
                    Export Name
                  </label>
                  <input
                    value={entry.key}
                    onChange={(e) => updateEntry(idx, { key: e.target.value })}
                    className={inputClasses}
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-[11px] font-medium opacity-80 mb-1">
                    Description
                  </label>
                  <input
                    value={entry.description}
                    onChange={(e) => updateEntry(idx, { description: e.target.value })}
                    placeholder="Optional description"
                    className={inputClasses}
                  />
                </div>

                {/* Sensitive toggle */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={entry.sensitive}
                    onChange={(e) => updateEntry(idx, { sensitive: e.target.checked })}
                    id={`sensitive-${idx}`}
                    className="accent-[#f0883e]"
                  />
                  <label htmlFor={`sensitive-${idx}`} className="text-xs opacity-90">
                    Sensitive
                  </label>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="p-4 border-t border-[#333] bg-[#1e1e1e] sticky bottom-0 z-30">
        <button
          className="w-full py-3 bg-[#1f6feb] text-white border-none rounded-[10px] font-bold text-sm cursor-pointer"
          onClick={handleSave}
        >
          Save outputs
        </button>
      </footer>
    </div>
  );
}
