import React, { useContext, useState, useCallback, useRef, useEffect } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { Use, Resource, InputDef, OutputDef } from '../../types/ir';
import { isOut, isUse } from '../../types/ir';
import { isValidTerraformIdentifier, parseModuleKey } from '../../utils/identifiers';
import { CanvasContext } from '../../state/context';

// ── Node data contract (serializable — no callbacks) ──

export type ModuleNodeData = {
  child: Use | Resource;
  schema: { inputs: InputDef[]; outputs: OutputDef[] };
  icon_url?: string;
  hasErrors?: boolean;
  errorMessages?: string[];
  connectedHandles?: string[];
};

type ModuleNodeNode = Node<ModuleNodeData, 'moduleNode'>;

// ── Sizes ──

const CARD_SIZE = 42;
const ICON_SIZE = 36;

// ── Broken icon fallback ──

function BrokenIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="rgba(206, 254, 101, 0.4)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
      <line x1="2" y1="2" x2="22" y2="22" stroke="rgba(206, 254, 101, 0.3)" strokeWidth="1.5" />
    </svg>
  );
}

// ── Component ──

const ModuleNode: React.FC<NodeProps<ModuleNodeNode>> = ({ id, data }) => {
  const ctx = useContext(CanvasContext);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(id);
  const [hovered, setHovered] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const child = data.child;
  const connected = data.connectedHandles ?? [];

  // Wired input badges
  const wiredBadges: { inputName: string; source: string }[] = [];
  for (const [inputName, binding] of Object.entries(child.inputs ?? {})) {
    if (isOut(binding)) {
      wiredBadges.push({
        inputName,
        source: `${binding.out.module}.${binding.out.name}`,
      });
    }
  }

  // ── Callbacks ──

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
    if (trimmed && trimmed !== id && isValidTerraformIdentifier(trimmed) && ctx) {
      ctx.dispatch({
        type: 'RENAME_INSTANCE',
        module_key: ctx.moduleKey,
        old_id: id,
        new_id: trimmed,
      });
    }
  }, [editValue, id, ctx]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') commitRename();
      else if (e.key === 'Escape') setEditing(false);
    },
    [commitRename],
  );

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      ctx?.openConfig(child.id);
    },
    [ctx, child.id],
  );

  const onRefreshModule = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!isUse(child) || !ctx) return;
      const { id: modId, version } = parseModuleKey(child.module);
      ctx.refreshModule(child.module, modId, version);
    },
    [child, ctx],
  );

  const onDeleteInstance = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!ctx) return;
      ctx.dispatch({
        type: 'DELETE_INSTANCE',
        module_key: ctx.moduleKey,
        instance_id: child.id,
      });
    },
    [child.id, ctx],
  );

  // ── Helpers ──

  const showIcon = data.icon_url && !imgFailed;

  function handleClass(handleId: string): string {
    return connected.includes(handleId) ? 'lace-handle lace-handle--connected' : 'lace-handle';
  }

  const errorBorder = data.hasErrors ? '1.5px solid #e5484d' : '1px solid transparent';

  const errorShadow = data.hasErrors ? '0 0 8px rgba(229, 72, 77, 0.3)' : 'none';

  return (
    <div
      className="relative cursor-pointer"
      style={{ width: CARD_SIZE, height: CARD_SIZE }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={data.hasErrors ? data.errorMessages?.join('\n') : child.id}
    >
      {/* ── Card (invisible unless error) ── */}
      <div
        className="w-full h-full rounded-sm flex items-center justify-center"
        style={{ border: errorBorder, boxShadow: errorShadow }}
      >
        {showIcon ? (
          <img
            src={data.icon_url}
            alt={child.id}
            className="rounded object-contain"
            style={{ width: ICON_SIZE, height: ICON_SIZE }}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <BrokenIcon />
        )}
      </div>

      {/* ── Hover action buttons ── */}
      {hovered && isUse(child) && (
        <button
          onClick={onRefreshModule}
          className="absolute rounded-full bg-[#153238] border border-[rgba(206,254,101,0.3)] border-solid text-[#CEFE65] leading-none cursor-pointer flex items-center justify-center z-10"
          style={{ top: -4, left: -4, width: 8, height: 8, padding: 0 }}
          title="Refresh from registry"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="6" height="6">
            <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
          </svg>
        </button>
      )}
      {hovered && (
        <button
          onClick={onDeleteInstance}
          className="absolute rounded-full bg-[#153238] border border-solid text-[#e5484d] leading-none cursor-pointer flex items-center justify-center z-10"
          style={{
            top: -4,
            right: -4,
            width: 8,
            height: 8,
            padding: 0,
            borderColor: 'rgba(229,72,77,0.4)',
          }}
          title="Delete instance"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="6" height="6">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
          </svg>
        </button>
      )}

      {/* ── Handles (CSS controls visibility) ── */}
      <Handle id="in-top" type="target" position={Position.Top} className={handleClass('in-top')} />
      <Handle
        id="in-left"
        type="target"
        position={Position.Left}
        className={handleClass('in-left')}
      />
      <Handle
        id="out-right"
        type="source"
        position={Position.Right}
        className={handleClass('out-right')}
      />
      <Handle
        id="out-bottom"
        type="source"
        position={Position.Bottom}
        className={handleClass('out-bottom')}
      />

      {/* ── Label ── */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 flex flex-col items-center pointer-events-auto">
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={onKeyDown}
            className="bg-[#161616] text-[#CEFE65] border border-[rgba(206,254,101,0.2)] rounded px-1 py-px text-center w-24"
            style={{ fontSize: 12 }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="whitespace-nowrap max-w-[100px] truncate"
            style={{ fontSize: 12, color: 'rgba(206, 254, 101, 0.65)' }}
            onDoubleClick={onDoubleClick}
          >
            {child.id}
          </span>
        )}

        {/* Wired input badges */}
        {wiredBadges.map((badge) => (
          <span
            key={badge.inputName}
            className="mt-px bg-[#161616] border border-[rgba(206,254,101,0.1)] px-1 rounded text-[#CEFE65] opacity-60 whitespace-nowrap"
            style={{ fontSize: 7 }}
          >
            {badge.source} → {badge.inputName}
          </span>
        ))}

        {/* Validation error */}
        {data.hasErrors && (
          <span className="mt-px text-[#e5484d] whitespace-nowrap" style={{ fontSize: 7 }}>
            ⚠ {data.errorMessages?.[0] ?? 'Error'}
          </span>
        )}
      </div>
    </div>
  );
};

export default ModuleNode;
