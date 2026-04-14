import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { NodePin, RenderNode } from '../../types/render';
import { useEngine } from '../../state/engine-context';
import { pinColor } from './pinColor';
import { CANVAS_EVENTS } from '../../events';

// ── Node data contract (serializable — no callbacks) ──

export type ModuleNodeData = RenderNode & {
  hasValidationError?: boolean;
  isNew?: boolean;
};

type ModuleNodeNode = Node<ModuleNodeData, 'moduleNode'>;

// ── Layout constants ──

const NODE_WIDTH = 200;
const HEADER_HEIGHT = 28;
const ROW_HEIGHT = 22;
const ICON_SIZE = 18;

// ── Node border/shadow by state ──

const NODE_COLORS = {
  error: { border: '#e5484d', shadow: '0 0 10px rgba(229, 72, 77, 0.3)' },
  new: { border: '#3b82f6', shadow: '0 0 10px rgba(59, 130, 246, 0.3)' },
  default: { border: 'rgba(206, 254, 101, 0.18)', shadow: '0 2px 6px rgba(0,0,0,0.35)' },
} as const;

function getNodeStyling(hasError: boolean, isNew: boolean) {
  const key = hasError ? 'error' : isNew ? 'new' : 'default';
  return { borderColor: NODE_COLORS[key].border, shadow: NODE_COLORS[key].shadow };
}

// ── Broken icon fallback ──

function BrokenIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="rgba(206, 254, 101, 0.5)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

// ── Pin row ──

type PinRowProps = {
  pin: NodePin;
  side: 'input' | 'output';
  top: number; // vertical offset inside the node body
  isError?: boolean;
};

const PinRow: React.FC<PinRowProps> = ({ pin, side, top, isError }) => {
  const color = pinColor(pin);
  const isInput = side === 'input';
  const handleStyle: React.CSSProperties = {
    background: color.fill,
    borderColor: isError ? '#e5484d' : color.stroke,
    borderWidth: isError ? 2 : 1,
    borderStyle: 'solid',
    width: 10,
    height: 10,
    [isInput ? 'left' : 'right']: -5,
    top: ROW_HEIGHT / 2,
  };
  return (
    <div
      className="lace-pin-row"
      style={{
        position: 'absolute',
        top,
        left: 0,
        right: 0,
        height: ROW_HEIGHT,
        paddingLeft: isInput ? 12 : 8,
        paddingRight: isInput ? 8 : 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: isInput ? 'flex-start' : 'flex-end',
      }}
      title={`${pin.name}: ${pin.type}${pin.description ? ` — ${pin.description}` : ''}`}
    >
      <Handle
        id={`${isInput ? 'in' : 'out'}:${pin.name}`}
        type={isInput ? 'target' : 'source'}
        position={isInput ? Position.Left : Position.Right}
        className="lace-pin-handle"
        style={handleStyle}
      />
      <span
        className="truncate"
        style={{
          fontSize: 10,
          color: isError ? '#e5484d' : 'rgba(236, 239, 237, 0.85)',
          maxWidth: NODE_WIDTH - 28,
        }}
      >
        {pin.name}
      </span>
    </div>
  );
};

// ── Component ──

const ModuleNode: React.FC<NodeProps<ModuleNodeNode>> = ({ id, data }) => {
  const engine = useEngine();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(id);
  const [hovered, setHovered] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showAllInputs, setShowAllInputs] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const renamingRef = useRef(false);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // ── Pin filtering ──

  const inputs = data.inputs ?? [];
  const outputs = data.outputs ?? [];

  const { visibleInputs, hiddenInputCount } = useMemo(() => {
    if (showAllInputs) {
      return { visibleInputs: inputs, hiddenInputCount: 0 };
    }
    const visible = inputs.filter((p) => p.required || p.wired);
    return {
      visibleInputs: visible,
      hiddenInputCount: inputs.length - visible.length,
    };
  }, [inputs, showAllInputs]);

  // ── Callbacks ──

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditValue(id);
      setEditing(true);
    },
    [id],
  );

  const commitRename = useCallback(async () => {
    if (renamingRef.current) return;
    renamingRef.current = true;
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== id) {
      try {
        const result = await engine.renameInstance(id, trimmed);
        window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.VIEW_UPDATED, { detail: result }));
      } catch (err) {
        console.error(`[ModuleNode] rename failed:`, err);
      }
    }
    renamingRef.current = false;
  }, [editValue, id, engine]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter') commitRename();
      else if (e.key === 'Escape') setEditing(false);
    },
    [commitRename],
  );

  const onHeaderClick = useCallback(
    (e: React.MouseEvent) => {
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
        window.dispatchEvent(
          new CustomEvent(CANVAS_EVENTS.OPEN_NODE_CONFIG, { detail: { instanceId: data.id } }),
        );
      }
    },
    [data.id],
  );

  const onDeleteInstance = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const result = await engine.deleteInstance(data.id);
        window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.VIEW_UPDATED, { detail: result }));
      } catch (err) {
        console.error(`[ModuleNode] delete failed:`, err);
      }
    },
    [data.id, engine],
  );

  const toggleCollapsed = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed((v) => !v);
  }, []);

  const toggleShowAllInputs = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowAllInputs((v) => !v);
  }, []);

  // ── Styling ──

  const showIcon = data.icon_url && !imgFailed;
  const hasAnyError = !!(data.has_errors || data.hasValidationError);
  const isNew = !!data.isNew && !hasAnyError;

  const { borderColor, shadow } = getNodeStyling(hasAnyError, isNew);

  // Body height — when collapsed, header only. Otherwise, whichever rail is
  // taller dictates the height. The "Show N more" toggle on the left counts
  // as an extra input row.
  const leftRows = visibleInputs.length + (hiddenInputCount > 0 ? 1 : 0);
  const rowCount = collapsed ? 0 : Math.max(leftRows, outputs.length);
  const bodyHeight = rowCount * ROW_HEIGHT;
  const nodeHeight = HEADER_HEIGHT + bodyHeight;

  return (
    <div
      className="relative"
      style={{
        width: NODE_WIDTH,
        height: nodeHeight,
        background: '#161616',
        border: `1px solid ${borderColor}`,
        borderRadius: 4,
        boxShadow: shadow,
        fontFamily: 'inherit',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── Header ── */}
      <div
        className="relative cursor-pointer"
        style={{
          height: HEADER_HEIGHT,
          background: '#153238',
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          borderBottom: collapsed ? 'none' : '1px solid rgba(206,254,101,0.12)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingLeft: 8,
          paddingRight: 6,
        }}
        onClick={onHeaderClick}
        title={hasAnyError ? data.error_messages?.join('\n') : data.id}
      >
        <button
          onClick={toggleCollapsed}
          className="leading-none cursor-pointer"
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(206,254,101,0.7)',
            padding: 0,
            width: 12,
            height: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10">
            {collapsed ? <path d="M8 5l8 7-8 7V5z" /> : <path d="M5 8l7 8 7-8H5z" />}
          </svg>
        </button>

        {showIcon ? (
          <img
            src={data.icon_url}
            alt=""
            className="rounded object-contain flex-shrink-0"
            style={{ width: ICON_SIZE, height: ICON_SIZE }}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="flex-shrink-0">
            <BrokenIcon />
          </div>
        )}

        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={onKeyDown}
            className="bg-[#161616] text-[#CEFE65] border border-[rgba(206,254,101,0.2)] rounded px-1 py-px flex-1"
            style={{ fontSize: 11 }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="truncate flex-1"
            style={{ fontSize: 11, color: '#CEFE65', fontWeight: 500 }}
            onDoubleClick={onDoubleClick}
          >
            {data.label}
          </span>
        )}

        {hovered && (
          <button
            onClick={onDeleteInstance}
            className="rounded-full leading-none cursor-pointer flex items-center justify-center flex-shrink-0"
            style={{
              background: 'rgba(229,72,77,0.15)',
              border: '1px solid rgba(229,72,77,0.4)',
              color: '#e5484d',
              width: 14,
              height: 14,
              padding: 0,
            }}
            title="Delete instance"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="8" height="8">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Body: input rail (left) + output rail (right), absolutely positioned rows ── */}
      {!collapsed && (
        <div style={{ position: 'relative', height: bodyHeight }}>
          {visibleInputs.map((pin, i) => {
            const errored = !!pin.required && !pin.wired;
            return (
              <PinRow
                key={`in:${pin.name}`}
                pin={pin}
                side="input"
                top={i * ROW_HEIGHT}
                isError={errored}
              />
            );
          })}
          {outputs.map((pin, i) => (
            <PinRow key={`out:${pin.name}`} pin={pin} side="output" top={i * ROW_HEIGHT} />
          ))}

          {hiddenInputCount > 0 && (
            <div
              onClick={toggleShowAllInputs}
              className="cursor-pointer"
              style={{
                position: 'absolute',
                top: visibleInputs.length * ROW_HEIGHT,
                left: 12,
                right: 12,
                height: ROW_HEIGHT,
                display: 'flex',
                alignItems: 'center',
                fontSize: 9,
                color: 'rgba(206,254,101,0.55)',
                fontStyle: 'italic',
              }}
              title="Show all inputs"
            >
              + {hiddenInputCount} more
            </div>
          )}
        </div>
      )}

      {/* ── Collapsed: stack all input handles on the left edge, outputs on right ── */}
      {collapsed && (
        <>
          {inputs.map((pin, i) => {
            const color = pinColor(pin);
            return (
              <Handle
                key={`in:${pin.name}`}
                id={`in:${pin.name}`}
                type="target"
                position={Position.Left}
                className="lace-pin-handle"
                style={{
                  background: color.fill,
                  borderColor: color.stroke,
                  borderWidth: 1,
                  borderStyle: 'solid',
                  width: 8,
                  height: 8,
                  top: HEADER_HEIGHT / 2 - 4 + (i - (inputs.length - 1) / 2) * 3,
                  left: -4,
                }}
              />
            );
          })}
          {outputs.map((pin, i) => {
            const color = pinColor(pin);
            return (
              <Handle
                key={`out:${pin.name}`}
                id={`out:${pin.name}`}
                type="source"
                position={Position.Right}
                className="lace-pin-handle"
                style={{
                  background: color.fill,
                  borderColor: color.stroke,
                  borderWidth: 1,
                  borderStyle: 'solid',
                  width: 8,
                  height: 8,
                  top: HEADER_HEIGHT / 2 - 4 + (i - (outputs.length - 1) / 2) * 3,
                  right: -4,
                }}
              />
            );
          })}
        </>
      )}
    </div>
  );
};

export default ModuleNode;
