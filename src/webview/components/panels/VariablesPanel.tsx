// src/webview/components/panels/VariablesPanel.tsx
import React, { useState, useCallback, useRef } from 'react';
import type { InputDef, Binding } from '../../types/ir';
import { isVar } from '../../types/ir';
import { isValidTerraformIdentifier } from '../../utils/identifiers';

// ── Props ──

type Props = {
  variables: InputDef[];
  /** All instances' inputs — used to warn when deleting a variable referenced by a var binding */
  all_instance_inputs: Record<string, Record<string, Binding>>;
  onSave: (variables: InputDef[]) => void;
  onClose: () => void;
};

// ── Type options for the dropdown ──

const TYPE_OPTIONS = ['string', 'number', 'bool', 'list(string)', 'map(string)', 'object'];

// ── Shared styles ──

const inputClasses =
  'w-full bg-[#0f0f0f] text-white border border-[#333] rounded-lg px-2.5 py-2 text-xs';

const btnClasses =
  'cursor-pointer border border-[#333] bg-[#0f0f0f] text-white rounded-lg px-2.5 py-1.5 text-xs';

// ── Empty variable template ──

function emptyVariable(): InputDef {
  return { name: '', type: 'string', required: false };
}

// ── Component ──

export default function VariablesPanel({ variables, all_instance_inputs, onSave, onClose }: Props) {
  const [items, setItems] = useState<InputDef[]>(() =>
    variables.length > 0 ? variables.map((v) => ({ ...v })) : [],
  );
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // ── Native drag-to-reorder state ──
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // ── Helpers ──

  const updateItem = useCallback((idx: number, patch: Partial<InputDef>) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  }, []);

  /** Check if any instance input has a `var` binding referencing this variable name */
  const isVariableReferenced = useCallback(
    (varName: string): string[] => {
      const refs: string[] = [];
      for (const [instId, inputs] of Object.entries(all_instance_inputs)) {
        for (const [inputName, binding] of Object.entries(inputs)) {
          if (isVar(binding) && binding.var === varName) {
            refs.push(`${instId}.${inputName}`);
          }
        }
      }
      return refs;
    },
    [all_instance_inputs],
  );

  // ── Add ──

  const handleAdd = useCallback(() => {
    setItems((prev) => [...prev, emptyVariable()]);
    setExpandedIdx(items.length);
  }, [items.length]);

  // ── Delete ──

  const handleDelete = useCallback(
    (idx: number) => {
      const item = items[idx];
      const refs = isVariableReferenced(item.name);
      if (refs.length > 0 && deleteConfirm !== idx) {
        setDeleteConfirm(idx);
        return;
      }
      setItems((prev) => prev.filter((_, i) => i !== idx));
      setDeleteConfirm(null);
      if (expandedIdx === idx) setExpandedIdx(null);
    },
    [items, isVariableReferenced, deleteConfirm, expandedIdx],
  );

  // ── Native HTML5 drag-to-reorder handlers ──

  const onDragStart = useCallback((e: React.DragEvent, idx: number) => {
    dragIdx.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    // Make the drag image slightly transparent
    const el = e.currentTarget as HTMLElement;
    el.style.opacity = '0.5';
  }, []);

  const onDragEnd = useCallback((e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1';
    dragIdx.current = null;
    setDragOverIdx(null);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragIdx.current === null || dragIdx.current === idx) return;
    setDragOverIdx(idx);
  }, []);

  const onDrop = useCallback((e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    const fromIdx = dragIdx.current;
    if (fromIdx === null || fromIdx === targetIdx) return;

    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });

    // Update expandedIdx to follow the moved item
    setExpandedIdx((prev) => {
      if (prev === null) return null;
      if (prev === fromIdx) return targetIdx;
      // Shift if between from and to
      if (fromIdx < targetIdx && prev > fromIdx && prev <= targetIdx) return prev - 1;
      if (fromIdx > targetIdx && prev >= targetIdx && prev < fromIdx) return prev + 1;
      return prev;
    });

    dragIdx.current = null;
    setDragOverIdx(null);
  }, []);

  // ── Validation ──

  const getNameError = useCallback(
    (name: string, idx: number): string | null => {
      if (!name.trim()) return 'Name is required';
      if (!isValidTerraformIdentifier(name)) return 'Must be a valid Terraform identifier';
      const duplicate = items.findIndex((v, i) => i !== idx && v.name === name);
      if (duplicate >= 0) return 'Duplicate variable name';
      return null;
    },
    [items],
  );

  // ── Save ──

  const handleSave = useCallback(() => {
    // Filter out empty-named entries
    const valid = items.filter((v) => v.name.trim() && isValidTerraformIdentifier(v.name));
    onSave(valid);
  }, [items, onSave]);

  const hasErrors = items.some((v, i) => getNameError(v.name, i) !== null);

  return (
    <div className="absolute right-0 top-0 w-[420px] h-full bg-[#1e1e1e] border-l border-[#333] flex flex-col z-20">
      {/* Header */}
      <header className="p-4 border-b border-[#333] flex justify-between items-center shrink-0">
        <div className="flex flex-col gap-1">
          <div className="text-xs opacity-70">Composite</div>
          <h3 className="m-0 text-base">Variables</h3>
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
        {items.length === 0 && (
          <div className="text-xs opacity-60 text-center py-6">
            No variables defined. Click "Add Variable" to create one.
          </div>
        )}

        {items.map((item, idx) => {
          const nameError = getNameError(item.name, idx);
          const isExpanded = expandedIdx === idx;
          const refs = item.name ? isVariableReferenced(item.name) : [];
          const isDragOver = dragOverIdx === idx;

          return (
            <div
              key={idx}
              draggable
              onDragStart={(e) => onDragStart(e, idx)}
              onDragEnd={onDragEnd}
              onDragOver={(e) => onDragOver(e, idx)}
              onDrop={(e) => onDrop(e, idx)}
              className={`mb-3 border rounded-lg bg-[#161616] overflow-hidden transition-[border-color] duration-100 ${
                isDragOver ? 'border-[#1f6feb]' : 'border-[#333]'
              }`}
            >
              {/* Collapsed row */}
              <div
                className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
              >
                {/* Drag handle */}
                <span
                  className="text-[11px] opacity-40 cursor-grab active:cursor-grabbing select-none"
                  title="Drag to reorder"
                >
                  ⠿
                </span>
                <span className="text-[10px] opacity-50">{isExpanded ? '▼' : '▶'}</span>
                <span className="text-xs font-semibold flex-1 truncate">
                  {item.name || <span className="opacity-40 italic">unnamed</span>}
                </span>
                <span className="text-[11px] font-mono opacity-60">{item.type}</span>
                {item.required && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#e5484d]/20 text-[#e5484d] font-bold">
                    req
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(idx);
                  }}
                  className={`${btnClasses} w-6 h-6 flex items-center justify-center p-0 text-[#e5484d]`}
                  title="Delete"
                >
                  ✕
                </button>
              </div>

              {/* Delete confirmation warning */}
              {deleteConfirm === idx && (
                <div className="px-3 pb-2">
                  <div className="text-[11px] text-[#f0883e] bg-[#f0883e]/10 rounded px-2 py-1.5">
                    ⚠ Referenced by: {refs.join(', ')}. Click delete again to confirm.
                  </div>
                </div>
              )}

              {/* Expanded editor */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-[#333] flex flex-col gap-3">
                  {/* Name */}
                  <div>
                    <label className="block text-[11px] font-medium opacity-80 mb-1">Name</label>
                    <input
                      value={item.name}
                      onChange={(e) => {
                        updateItem(idx, { name: e.target.value });
                        setDeleteConfirm(null);
                      }}
                      placeholder="e.g. bucket_name"
                      className={`${inputClasses} ${nameError ? 'border-[#e5484d]' : ''}`}
                    />
                    {nameError && (
                      <div className="text-[10px] text-[#e5484d] mt-0.5">{nameError}</div>
                    )}
                  </div>

                  {/* Type */}
                  <div>
                    <label className="block text-[11px] font-medium opacity-80 mb-1">Type</label>
                    <select
                      value={item.type}
                      onChange={(e) => updateItem(idx, { type: e.target.value })}
                      className={inputClasses}
                    >
                      {TYPE_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Required toggle */}
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={item.required}
                      onChange={(e) => updateItem(idx, { required: e.target.checked })}
                      id={`req-${idx}`}
                      className="accent-[#1f6feb]"
                    />
                    <label htmlFor={`req-${idx}`} className="text-xs opacity-90">
                      Required
                    </label>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-[11px] font-medium opacity-80 mb-1">
                      Description
                    </label>
                    <input
                      value={item.description ?? ''}
                      onChange={(e) =>
                        updateItem(idx, {
                          description: e.target.value || undefined,
                        })
                      }
                      placeholder="Optional description"
                      className={inputClasses}
                    />
                  </div>

                  {/* Default value */}
                  <div>
                    <label className="block text-[11px] font-medium opacity-80 mb-1">
                      Default Value
                    </label>
                    <DefaultValueEditor
                      type={item.type}
                      value={item.default}
                      onChange={(val) => updateItem(idx, { default: val })}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Add button */}
        <button
          onClick={handleAdd}
          className="w-full py-2.5 mt-2 border border-dashed border-[#555] rounded-lg bg-transparent text-white text-xs cursor-pointer opacity-80 hover:opacity-100"
        >
          + Add Variable
        </button>
      </div>

      {/* Footer */}
      <footer className="p-4 border-t border-[#333] bg-[#1e1e1e] sticky bottom-0 z-30">
        <button
          className={`w-full py-3 text-white border-none rounded-[10px] font-bold text-sm cursor-pointer ${
            hasErrors ? 'bg-[#555] cursor-not-allowed' : 'bg-[#1f6feb]'
          }`}
          disabled={hasErrors}
          onClick={handleSave}
        >
          Save variables
        </button>
      </footer>
    </div>
  );
}

// ── Default value editor ──

function DefaultValueEditor({
  type,
  value,
  onChange,
}: {
  type: string;
  value: any;
  onChange: (val: any) => void;
}) {
  if (type === 'bool') {
    return (
      <select
        value={value === undefined ? '' : String(value)}
        onChange={(e) => {
          if (e.target.value === '') onChange(undefined);
          else onChange(e.target.value === 'true');
        }}
        className={inputClasses}
      >
        <option value="">No default</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (type === 'number') {
    return (
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        placeholder="No default"
        className={inputClasses}
      />
    );
  }

  if (
    type === 'object' ||
    type.startsWith('list(') ||
    type.startsWith('map(') ||
    type.startsWith('object(') ||
    type.startsWith('set(')
  ) {
    const jsonStr =
      value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return (
      <textarea
        value={jsonStr}
        onChange={(e) => {
          if (!e.target.value.trim()) {
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(e.target.value));
          } catch {
            onChange(e.target.value);
          }
        }}
        rows={3}
        placeholder="e.g. {} or []"
        className={`${inputClasses} font-mono resize-y`}
      />
    );
  }

  // Default: string
  return (
    <input
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      placeholder="No default"
      className={inputClasses}
    />
  );
}
