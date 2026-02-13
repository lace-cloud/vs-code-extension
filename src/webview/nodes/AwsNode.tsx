import React from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'react-flow-renderer';

const handleStyle: React.CSSProperties = {
  width: 10,
  height: 10,
  background: 'transparent',
  border: '2px solid #ffffff',
  borderRadius: '50%',
  transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
};



const AwsNode: React.FC<NodeProps> = ({ id, data }) => {
  const { setNodes, setEdges } = useReactFlow();

  const onDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNodes((n) => n.filter((x) => x.id !== id));
    setEdges((e) =>
      e.filter((x) => x.source !== id && x.target !== id)
    );
    data?.onDirty?.();
  };

  return (
    <div
      onDoubleClick={(e) => {
        e.stopPropagation();
        data?.onOpenConfig?.(id);
      }}
      style={{
        background: '#1e1e1e',
        border: '1px solid #333',
        borderRadius: 8,
        padding: 10,
        width: 140,
        color: '#fff',
        textAlign: 'center',
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      {/* ❌ delete button */}
      <button
        onClick={onDelete}
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#e5484d',
          border: 'none',
          color: '#fff',
          fontSize: 12,
        }}
      >
        ✕
      </button>

      {/* 🔼 TOP – input */}
      <Handle
        type="target"
        position={Position.Top}
        style={handleStyle}
      />

      {/* ◀️ LEFT – input */}
      <Handle
        type="target"
        position={Position.Left}
        style={handleStyle}
      />

      <div style={{ fontSize: 12 }}>{data.label}</div>

      {/* ▶️ RIGHT – output */}
      <Handle
        type="source"
        position={Position.Right}
        style={handleStyle}
      />

      {/* 🔽 BOTTOM – output */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={handleStyle}
      />
    </div>
  );
};

export default AwsNode;
