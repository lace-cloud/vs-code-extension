import React from 'react';
import { Handle, Position, NodeProps } from 'react-flow-renderer';

const AwsNode: React.FC<NodeProps> = ({ data }) => {
  return (
    <div
      style={{
        background: '#1e1e1e',
        border: '1px solid #333',
        borderRadius: 8,
        padding: 10,
        width: 120,
        textAlign: 'center',
        color: '#fff',
      }}
    >
      {/* Top handle */}
      <Handle type="target" position={Position.Top} />

      <img
        src={data.icon}
        alt={data.label}
        style={{ width: 36, height: 36, marginBottom: 6 }}
      />

      <div style={{ fontSize: 12 }}>{data.label}</div>

      {/* Bottom handle */}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
};

export default AwsNode;
