import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CANVAS_EVENTS } from '../../events';
import { useCanvas, useEngine } from '../../state/engine-context';
import './GroupNode.css';

// ── Data contract ──

export type ExternalPin = {
  handleId: string; // e.g. "out:vpc/vpc_id"
  label: string; // e.g. "vpc.vpc_id"
  side: 'input' | 'output';
  color: { fill: string; stroke: string };
};

export type GroupNodeData = {
  groupId: string;
  label: string;
  memberCount: number;
  collapsed: boolean;
  hasErrors: boolean;
  externalPins: ExternalPin[];
};

type GroupNodeNode = Node<GroupNodeData, 'groupNode'>;

// ── Layout constants ──

const HEADER_HEIGHT = 32;
const ROW_HEIGHT = 22;
const COLLAPSED_WIDTH = 220;
const MIN_EXPANDED_WIDTH = 280;
const MIN_EXPANDED_HEIGHT = 120;

// ── Shared header ──

type GroupHeaderProps = {
  label: string;
  memberCount: number;
  collapsed: boolean;
  hovered: boolean;
  editing: boolean;
  editValue: string;
  inputRef: React.RefObject<HTMLInputElement>;
  onToggleCollapsed: (e: React.MouseEvent) => void;
  onUngroup: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  onEditChange: (value: string) => void;
  onEditBlur: () => void;
  onEditKeyDown: (e: React.KeyboardEvent) => void;
};

const GroupHeader: React.FC<GroupHeaderProps> = ({
  label,
  memberCount,
  collapsed,
  hovered,
  editing,
  editValue,
  inputRef,
  onToggleCollapsed,
  onUngroup,
  onDoubleClick,
  onEditChange,
  onEditBlur,
  onEditKeyDown,
}) => (
  <div
    className={`lace-group-node__header lace-group-node__header--${collapsed ? 'collapsed' : 'expanded'}`}
    style={{ height: HEADER_HEIGHT }}
  >
    <button
      type="button"
      onClick={onToggleCollapsed}
      className="lace-group-node__collapse-btn"
      title={collapsed ? 'Expand' : 'Collapse'}
      aria-label={collapsed ? 'Expand' : 'Collapse'}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10" aria-hidden="true">
        {collapsed ? <path d="M8 5l8 7-8 7V5z" /> : <path d="M5 8l7 8 7-8H5z" />}
      </svg>
    </button>

    {editing ? (
      <input
        ref={inputRef}
        value={editValue}
        onChange={(e) => onEditChange(e.target.value)}
        onBlur={onEditBlur}
        onKeyDown={onEditKeyDown}
        className="lace-group-node__rename-input"
        onClick={(e) => e.stopPropagation()}
      />
    ) : (
      <span className="lace-group-node__label" onDoubleClick={onDoubleClick} title={label}>
        {label}
      </span>
    )}

    <span className="lace-group-node__count">
      {collapsed ? `${memberCount} nodes` : memberCount}
    </span>

    {hovered && (
      <button
        type="button"
        onClick={onUngroup}
        className="lace-group-node__ungroup-btn"
        title="Ungroup"
        aria-label="Ungroup"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          width="8"
          height="8"
          aria-hidden="true"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    )}
  </div>
);

// ── Aggregated pin row (collapsed state) ──

const AggregatedPinRow: React.FC<{ pin: ExternalPin; top: number }> = ({ pin, top }) => {
  const isInput = pin.side === 'input';
  return (
    <div
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
      title={pin.label}
    >
      <Handle
        id={pin.handleId}
        type={isInput ? 'target' : 'source'}
        position={isInput ? Position.Left : Position.Right}
        isConnectable={false}
        className="lace-pin-handle"
        style={{
          background: pin.color.fill,
          borderColor: pin.color.stroke,
          borderWidth: 1,
          borderStyle: 'solid',
          width: 10,
          height: 10,
          [isInput ? 'left' : 'right']: -5,
          top: ROW_HEIGHT / 2,
        }}
      />
      <span className="lace-group-node__pin-label" style={{ maxWidth: COLLAPSED_WIDTH - 28 }}>
        {pin.label}
      </span>
    </div>
  );
};

// ── Component ──

const GroupNode: React.FC<NodeProps<GroupNodeNode>> = ({ data }) => {
  const engine = useEngine();
  const { readOnly, toggleLocalGroupCollapse } = useCanvas();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(data.label);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // `data.collapsed` already reflects the effective collapsed state in
  // both modes — in read-only, App merges the local override into the
  // groups array before it reaches useGroupLogic, so there's nothing
  // to derive here. Keep the name local so subsequent references stay
  // stable.
  const collapsed = data.collapsed;

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return;
      e.stopPropagation();
      setEditValue(data.label);
      setEditing(true);
    },
    [data.label, readOnly],
  );

  const commitRename = useCallback(async () => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== data.label) {
      try {
        const result = await engine.updateGroup(data.groupId, { label: trimmed });
        window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.VIEW_UPDATED, { detail: result }));
      } catch (err) {
        console.error('[GroupNode] rename failed:', err);
      }
    }
  }, [editValue, data.label, data.groupId, engine]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter') commitRename();
      else if (e.key === 'Escape') setEditing(false);
    },
    [commitRename],
  );

  const toggleCollapsed = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (readOnly) {
        toggleLocalGroupCollapse(data.groupId, data.collapsed);
        return;
      }
      try {
        const result = await engine.updateGroup(data.groupId, { collapsed: !data.collapsed });
        window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.VIEW_UPDATED, { detail: result }));
      } catch (err) {
        console.error('[GroupNode] toggle collapsed failed:', err);
      }
    },
    [engine, data.groupId, data.collapsed, readOnly, toggleLocalGroupCollapse],
  );

  const onUngroup = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const result = await engine.deleteGroup(data.groupId);
        window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.VIEW_UPDATED, { detail: result }));
      } catch (err) {
        console.error('[GroupNode] ungroup failed:', err);
      }
    },
    [engine, data.groupId],
  );

  const headerProps = {
    label: data.label,
    memberCount: data.memberCount,
    collapsed,
    hovered: hovered && !readOnly,
    editing,
    editValue,
    inputRef,
    onToggleCollapsed: toggleCollapsed,
    onUngroup,
    onDoubleClick,
    onEditChange: setEditValue,
    onEditBlur: commitRename,
    onEditKeyDown: onKeyDown,
  };

  // ── Collapsed rendering ──

  if (collapsed) {
    const inputPins = data.externalPins.filter((p) => p.side === 'input');
    const outputPins = data.externalPins.filter((p) => p.side === 'output');
    const rowCount = Math.max(inputPins.length, outputPins.length);
    const bodyHeight = rowCount * ROW_HEIGHT;

    return (
      <div
        data-group={data.groupId}
        data-collapsed="true"
        className={`lace-group-node lace-group-node--collapsed${data.hasErrors ? ' lace-group-node--error' : ''}`}
        style={{ width: COLLAPSED_WIDTH, height: HEADER_HEIGHT + bodyHeight }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <GroupHeader {...headerProps} />
        {rowCount > 0 && (
          <div style={{ position: 'relative', height: bodyHeight }}>
            {inputPins.map((pin, i) => (
              <AggregatedPinRow key={pin.handleId} pin={pin} top={i * ROW_HEIGHT} />
            ))}
            {outputPins.map((pin, i) => (
              <AggregatedPinRow key={pin.handleId} pin={pin} top={i * ROW_HEIGHT} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Expanded rendering ──

  return (
    <div
      data-group={data.groupId}
      data-collapsed="false"
      className="lace-group-node lace-group-node--expanded"
      style={{
        width: '100%',
        height: '100%',
        minWidth: MIN_EXPANDED_WIDTH,
        minHeight: MIN_EXPANDED_HEIGHT,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <GroupHeader {...headerProps} />
    </div>
  );
};

export default GroupNode;
