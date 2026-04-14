import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useEngine } from '../../state/engine-context';
import { CANVAS_EVENTS } from '../../events';

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
  background: string;
  borderRadius: string;
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
  background,
  borderRadius,
}) => (
  <div
    style={{
      height: HEADER_HEIGHT,
      background,
      borderTopLeftRadius: borderRadius,
      borderTopRightRadius: borderRadius,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      paddingLeft: 8,
      paddingRight: 6,
    }}
  >
    <button
      onClick={onToggleCollapsed}
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

    {editing ? (
      <input
        ref={inputRef}
        value={editValue}
        onChange={(e) => onEditChange(e.target.value)}
        onBlur={onEditBlur}
        onKeyDown={onEditKeyDown}
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
        {label}
      </span>
    )}

    <span style={{ fontSize: 9, color: 'rgba(206,254,101,0.5)', flexShrink: 0 }}>
      {collapsed ? `${memberCount} nodes` : memberCount}
    </span>

    {hovered && (
      <button
        onClick={onUngroup}
        className="rounded-full leading-none cursor-pointer flex items-center justify-center flex-shrink-0"
        style={{
          background: 'rgba(155,161,158,0.15)',
          border: '1px solid rgba(155,161,158,0.4)',
          color: '#9BA19E',
          width: 14,
          height: 14,
          padding: 0,
        }}
        title="Ungroup"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          width="8"
          height="8"
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
      <span
        className="truncate"
        style={{ fontSize: 10, color: 'rgba(236,239,237,0.85)', maxWidth: COLLAPSED_WIDTH - 28 }}
      >
        {pin.label}
      </span>
    </div>
  );
};

// ── Component ──

const GroupNode: React.FC<NodeProps<GroupNodeNode>> = ({ data }) => {
  const engine = useEngine();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(data.label);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditValue(data.label);
      setEditing(true);
    },
    [data.label],
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
      try {
        const result = await engine.updateGroup(data.groupId, { collapsed: !data.collapsed });
        window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.VIEW_UPDATED, { detail: result }));
      } catch (err) {
        console.error('[GroupNode] toggle collapsed failed:', err);
      }
    },
    [engine, data.groupId, data.collapsed],
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

  // Shared header props
  const headerProps = {
    label: data.label,
    memberCount: data.memberCount,
    collapsed: data.collapsed,
    hovered,
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

  if (data.collapsed) {
    const inputPins = data.externalPins.filter((p) => p.side === 'input');
    const outputPins = data.externalPins.filter((p) => p.side === 'output');
    const rowCount = Math.max(inputPins.length, outputPins.length);
    const bodyHeight = rowCount * ROW_HEIGHT;

    return (
      <div
        className="relative"
        style={{
          width: COLLAPSED_WIDTH,
          height: HEADER_HEIGHT + bodyHeight,
          background: '#161616',
          border: data.hasErrors ? '1px solid #e5484d' : '1px dashed rgba(206, 254, 101, 0.25)',
          borderRadius: 4,
          boxShadow: data.hasErrors
            ? '0 0 10px rgba(229, 72, 77, 0.3)'
            : '0 2px 6px rgba(0,0,0,0.35)',
          fontFamily: 'inherit',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <GroupHeader {...headerProps} background="#1a2a20" borderRadius="4px" />
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
      className="relative"
      style={{
        width: '100%',
        height: '100%',
        minWidth: MIN_EXPANDED_WIDTH,
        minHeight: MIN_EXPANDED_HEIGHT,
        background: 'rgba(206, 254, 101, 0.03)',
        border: '1px dashed rgba(206, 254, 101, 0.18)',
        borderRadius: 6,
        fontFamily: 'inherit',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <GroupHeader {...headerProps} background="rgba(21, 50, 56, 0.6)" borderRadius="6px" />
    </div>
  );
};

export default GroupNode;
