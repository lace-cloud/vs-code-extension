// src/webview/components/nodes/AwsNode.tsx
import React from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'react-flow-renderer';

const handleGenericStyle =
  'w-2.5 h-2.5 bg-transparent border-2 border-white rounded-full transition-[box-shadow, border-color] duration-150 ease-in-out';

const AwsNode: React.FC<NodeProps> = ({ id, data }) => {
  const { setNodes, setEdges } = useReactFlow();

  const onDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNodes((n) => n.filter((x) => x.id !== id));
    setEdges((e2) => e2.filter((x) => x.source !== id && x.target !== id));
    data?.__runtime?.onDirty?.();
  };

  return (
    <div
      onDoubleClick={(e) => {
        e.stopPropagation();
        data?.__runtime?.onOpenConfig?.(id);
      }}
      className="bg-[#1e1e1e] border border-slate-400 shadow-gray-400 shadow-sm rounded-lg p-2.5 w-35 text-white text-center cursor-pointer relative flex items-center justify-center"
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
          cursor: 'pointer',
        }}
        title="Delete"
      >
        ✕
      </button>

      {/* 🔼 TOP – input */}
      <Handle id="in-top" type="target" position={Position.Top} className={handleGenericStyle} />

      {/* ◀️ LEFT – input */}
      <Handle id="in-left" type="target" position={Position.Left} className={handleGenericStyle} />

      <div className="text-xs">{data.label}</div>

      {/* ▶️ RIGHT – output */}
      <Handle
        id="out-right"
        type="source"
        position={Position.Right}
        className={handleGenericStyle}
      />

      {/* 🔽 BOTTOM – output */}
      <Handle
        id="out-bottom"
        type="source"
        position={Position.Bottom}
        className={handleGenericStyle}
      />

      {/* 🔗 show wired inputs */}
      {data?.wiredInputs &&
        Object.keys(data.wiredInputs).map((inputName) => (
          <div
            key={inputName}
            style={{
              marginTop: 4,
              fontSize: 10,
              background: '#0f5132',
              padding: '2px 4px',
              borderRadius: 4,
              color: '#fff',
            }}
          >
            🔗 {inputName}
          </div>
        ))}
    </div>
  );
};

export default AwsNode;
