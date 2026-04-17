import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CANVAS_EVENTS } from '../../events';
import { useCanvas, useEngine } from '../../state/engine-context';
import type { NodePin, RenderNode } from '../../types/render';
import './ModuleNode.css';
import { pinColor } from './pinColor';

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

// Border / shadow variants now live in ModuleNode.css as
// `.lace-module-node--error` / `--new` classes. Node colors flow
// through design tokens.

// ── Broken icon fallback ──

function BrokenIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--lace-color-green-alpha-50)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
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
    borderColor: isError ? 'var(--lace-color-red-500)' : color.stroke,
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
        className={`lace-module-node__pin-row-label lace-module-node__pin-row-label--${isError ? 'error' : 'default'}`}
        style={{ maxWidth: NODE_WIDTH - 28 }}
      >
        {pin.name}
      </span>
    </div>
  );
};

// ── Component ──

const ModuleNode: React.FC<NodeProps<ModuleNodeNode>> = ({ id, data }) => {
  const engine = useEngine();
  const { readOnly } = useCanvas();
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
      if (readOnly) return;
      e.stopPropagation();
      setEditValue(id);
      setEditing(true);
    },
    [id, readOnly],
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

  // Body height — when collapsed, header only. Otherwise, whichever rail is
  // taller dictates the height. The "Show N more" toggle on the left counts
  // as an extra input row.
  const leftRows = visibleInputs.length + (hiddenInputCount > 0 ? 1 : 0);
  const rowCount = collapsed ? 0 : Math.max(leftRows, outputs.length);
  const bodyHeight = rowCount * ROW_HEIGHT;
  const nodeHeight = HEADER_HEIGHT + bodyHeight;

  const stateClass = hasAnyError ? 'lace-module-node--error' : isNew ? 'lace-module-node--new' : '';

  return (
    <div
      className={`lace-module-node${collapsed ? ' lace-module-node--collapsed' : ''}${stateClass ? ` ${stateClass}` : ''}`}
      style={{ width: NODE_WIDTH, height: nodeHeight }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── Header ── */}
      <div
        className="lace-module-node__header"
        style={{ height: HEADER_HEIGHT }}
        onClick={onHeaderClick}
        title={hasAnyError ? data.error_messages?.join('\n') : data.label}
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          className="lace-module-node__collapse-btn"
          title={collapsed ? 'Expand' : 'Collapse'}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10" aria-hidden="true">
            {collapsed ? <path d="M8 5l8 7-8 7V5z" /> : <path d="M5 8l7 8 7-8H5z" />}
          </svg>
        </button>

        {showIcon ? (
          <img
            src={data.icon_url}
            alt=""
            className="lace-module-node__icon"
            style={{ width: ICON_SIZE, height: ICON_SIZE }}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="lace-module-node__icon-fallback">
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
            className="lace-module-node__rename-input"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="lace-module-node__label"
            onDoubleClick={onDoubleClick}
            title={data.label}
          >
            {data.label}
          </span>
        )}

        {hovered && !readOnly && (
          <button
            type="button"
            onClick={onDeleteInstance}
            className="lace-module-node__delete-btn"
            title="Delete instance"
            aria-label="Delete instance"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="8" height="8" aria-hidden="true">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Body: input rail (left) + output rail (right), absolutely positioned rows ── */}
      {!collapsed && (
        <div className="lace-module-node__body" style={{ height: bodyHeight }}>
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
              className="lace-module-node__hidden-count"
              onClick={toggleShowAllInputs}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ')
                  toggleShowAllInputs(e as unknown as React.MouseEvent);
              }}
              role="button"
              tabIndex={0}
              style={{
                top: visibleInputs.length * ROW_HEIGHT,
                left: 12,
                right: 12,
                height: ROW_HEIGHT,
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
