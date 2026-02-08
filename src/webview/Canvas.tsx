import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactFlow, {
  applyNodeChanges,
  applyEdgeChanges,
  Background,
  Controls,
  Node,
  Edge,
  NodeChange,
  EdgeChange,
} from 'react-flow-renderer';

import AwsNode from './nodes/AwsNode';

const nodeTypes = {
  awsNode: AwsNode,
};

export const Canvas: React.FC = () => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);

  // keep refs in sync for save
  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  // VS Code messaging
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const { command, state } = event.data || {};

      if (command === 'loadState') {
        setNodes(state?.nodes ?? []);
        setEdges(state?.edges ?? []);
      }

      if (command === 'triggerSave') {
        handleSave();
      }
    };

    window.addEventListener('message', handler);
    window.vscode.postMessage({ command: 'webviewReady' });

    return () => window.removeEventListener('message', handler);
  }, []);

  const markDirty = useCallback(() => {
    window.vscode.postMessage({ command: 'markDirty' });
  }, []);

  const handleSave = useCallback(() => {
    window.vscode.postMessage({
      command: 'saveState',
      state: {
        nodes: nodesRef.current,
        edges: edgesRef.current,
      },
    });
  }, []);

  // 🔥 Node changes (including delete)
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => {
        const updated = applyNodeChanges(changes, nds);

        // detect removed nodes
        const removedIds = changes
          .filter((c) => c.type === 'remove')
          .map((c) => c.id);

        if (removedIds.length) {
          setEdges((eds) =>
            eds.filter(
              (e) =>
                !removedIds.includes(e.source) &&
                !removedIds.includes(e.target)
            )
          );
        }

        markDirty();
        return updated;
      });
    },
    [markDirty]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => {
        const updated = applyEdgeChanges(changes, eds);
        markDirty();
        return updated;
      });
    },
    [markDirty]
  );

  // drag from sidebar
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (!type) return;

      const position = {
        x: event.clientX - 250,
        y: event.clientY - 100,
      };

      const newNode: Node = {
        id: `${type}-${Date.now()}`,
        type: 'awsNode',
        position,
        data: {
          label: type.toUpperCase(),
          icon: window.iconPaths[type],
        },
      };

      setNodes((nds) => [...nds, newNode]);
      markDirty();
    },
    [markDirty]
  );

  return (
    <div
      className="canvas"
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      >
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
};

export default Canvas;
