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

export const Canvas: React.FC = () => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);

  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  // ✅ SINGLE, STABLE message handler
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const { command, state } = event.data || {};

      if (command === 'loadState') {
        console.log('Restoring canvas state:', state);
        setNodes(state?.nodes ?? []);
        setEdges(state?.edges ?? []);
      }

      if (command === 'triggerSave') {
        handleSave();
      }
    };

    window.addEventListener('message', handler);

    // 🔥 handshake (this is correct)
    window.vscode.postMessage({ command: 'webviewReady' });

    return () => {
      window.removeEventListener('message', handler);
    };
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

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => {
        const updated = applyNodeChanges(changes, nds);
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
        type: 'default',
        position,
        data: { label: type },
      };

      setNodes((nds) => [...nds, newNode]);
      markDirty();
    },
    [markDirty]
  );

  return (
    <div className="canvas" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
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
