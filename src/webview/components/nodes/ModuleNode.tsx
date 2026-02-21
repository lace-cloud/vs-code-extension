import React, { useContext, useState, useCallback, useRef, useEffect } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { Instance, InputDef, OutputDef } from '../../types/ir';
import { isOut } from '../../types/ir';
import { isValidTerraformIdentifier } from '../../utils/identifiers';
import { CanvasContext } from '../../state/context';

// ── Node data contract (serializable — no callbacks) ──

export type ModuleNodeData = {
  instance: Instance;
  schema: { inputs: InputDef[]; outputs: OutputDef[] };
  hasErrors?: boolean;
  errorMessages?: string[];
};

// v12: NodeProps takes the full Node type, not just the data
type ModuleNodeNode = Node<ModuleNodeData, 'moduleNode'>;

// ── Handle style ──

const handleStyle =
  'w-2.5 h-2.5 bg-transparent border-2 border-white rounded-full transition-[box-shadow,border-color] duration-150 ease-in-out';

// ── Component ──

const ModuleNode: React.FC<NodeProps<ModuleNodeNode>> = ({ id, data }) => {
  const ctx = useContext(CanvasContext);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(id);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const instance = data.instance;

  // Wired input badges: show all `out` bindings
  const wiredBadges: { inputName: string; source: string }[] = [];
  for (const [inputName, binding] of Object.entries(instance.inputs)) {
    if (isOut(binding)) {
      wiredBadges.push({
        inputName,
        source: `${binding.out.module}.${binding.out.name}`,
      });
    }
  }

  // ── Inline rename ──

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditValue(id);
      setEditing(true);
    },
    [id],
  );

  const commitRename = useCallback(() => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== id && isValidTerraformIdentifier(trimmed)) {
      const dispatch = (window as any).__canvasDispatch;
      const moduleKey = (window as any).__activeModuleKey;
      if (dispatch && moduleKey) {
        dispatch({
          type: 'RENAME_INSTANCE',
          module_key: moduleKey,
          old_id: id,
          new_id: trimmed,
        });
      }
    }
  }, [editValue, id]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        commitRename();
      } else if (e.key === 'Escape') {
        setEditing(false);
      }
    },
    [commitRename],
  );

  // ── Click → open config ──

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      ctx?.openConfig(instance.id);
    },
    [ctx, instance.id],
  );

  // ── Delete ──

  const onDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const dispatch = (window as any).__canvasDispatch;
      const moduleKey = (window as any).__activeModuleKey;
      if (dispatch && moduleKey) {
        dispatch({
          type: 'DELETE_INSTANCE',
          module_key: moduleKey,
          instance_id: id,
        });
      }
    },
    [id],
  );

  return (
    <div
      onClick={onClick}
      className={`bg-[#1e1e1e] border ${data.hasErrors ? 'border-2 border-[#e5484d] shadow-[0_0_6px_rgba(229,72,77,0.4)]' : 'border border-slate-400 shadow-gray-400 shadow-sm'} rounded-lg p-2.5 max-w-64 text-white text-center cursor-pointer relative`}
      title={data.hasErrors ? data.errorMessages?.join('\n') : undefined}
    >
      {/* Delete button */}
      <button
        onClick={onDelete}
        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[#e5484d] border-none text-white text-xs cursor-pointer flex items-center justify-center"
        title="Delete"
      >
        ✕
      </button>

      {/* Handles */}
      <Handle id="in-top" type="target" position={Position.Top} className={handleStyle} />
      <Handle id="in-left" type="target" position={Position.Left} className={handleStyle} />

      {/* Label / inline rename */}
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={onKeyDown}
          className="bg-[#0f0f0f] text-white border border-[#555] rounded px-1 py-0.5 text-xs text-center w-full"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="text-xs" onDoubleClick={onDoubleClick}>
          {instance.id}
        </div>
      )}

      {/* Wired input badges */}
      {wiredBadges.map((badge) => (
        <div
          key={badge.inputName}
          className="mt-1 text-[10px] bg-[#0f5132] px-1 py-0.5 rounded text-white"
        >
          {badge.source} → {badge.inputName}
        </div>
      ))}

      {/* Validation error indicator */}
      {data.hasErrors && (
        <div className="mt-1 text-[10px] text-[#e5484d] truncate">
          ⚠ {data.errorMessages?.[0] ?? 'Validation error'}
        </div>
      )}

      <Handle id="out-right" type="source" position={Position.Right} className={handleStyle} />
      <Handle id="out-bottom" type="source" position={Position.Bottom} className={handleStyle} />
    </div>
  );
};

export default ModuleNode;
