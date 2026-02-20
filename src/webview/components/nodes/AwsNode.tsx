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
      className="bg-[#1e1e1e] border border-slate-400 shadow-gray-400 shadow-sm rounded-lg p-2.5 max-w-64 text-white text-center cursor-pointer relative flex items-center justify-center"
    >
      {/* ❌ delete button */}
      <button
        onClick={onDelete}
        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[#e5484d] border-none text-white text-xs cursor-pointer flex items-center justify-center"
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
            className="mt-1 text-[10px] bg-[#0f5132] px-1 py-0.5 rounded text-white"
          >
            🔗 {inputName}
          </div>
        ))}
    </div>
  );
};

export default AwsNode;
