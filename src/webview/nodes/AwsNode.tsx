import React from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'react-flow-renderer';

const AwsNode: React.FC<NodeProps> = ({ id, data }) => {
  const { setNodes, setEdges } = useReactFlow();

  const handleDelete = () => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) =>
      eds.filter((e) => e.source !== id && e.target !== id)
    );
  };

  return (
    <div
      style={{
        position: 'relative',
        background: '#1e1e1e',
        border: '1px solid #333',
        borderRadius: 8,
        padding: 10,
        width: 120,
        textAlign: 'center',
        color: '#fff',
      }}
    >
      {/* ❌ Delete button */}
      <button
        onClick={handleDelete}
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: 'none',
          background: '#e5484d',
          color: '#fff',
          fontSize: 12,
          cursor: 'pointer',
          lineHeight: '18px',
        }}
      >
        ✕
      </button>

      <Handle type="target" position={Position.Top} />

      <img
        src={data.icon}
        alt={data.label}
        style={{ width: 36, height: 36, marginBottom: 6 }}
      />

      <div style={{ fontSize: 12 }}>{data.label}</div>

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
};

export default AwsNode;
