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

// declare global {
//   interface Window {
//     vscode: {
//       postMessage: (message: any) => void;
//     };
//     iconPaths: { [key: string]: string };
//   }
// }

export const Canvas: React.FC = () => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  // Refs to ensure latest state is captured
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);

  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  useEffect(() => {
    window.addEventListener('message', (event) => {
      const { command, state } = event.data || {};
      if (command === 'loadState' && state) {
        console.log('Restoring state from extension:', state);
        setNodes(state.nodes || []);
        setEdges(state.edges || []);
      } else if (command === 'triggerSave') {
        handleSave(); // Trigger save on File > Save
      }
    });

    // Request initial state load
    window.vscode.postMessage({ command: 'requestLoadState' });

    return () => window.removeEventListener('message', () => {});
  }, []);

  useEffect(() => {
    // Post updated state to the WebView whenever nodes or edges change
    const state = { nodes, edges };
    console.log('Posting updated state to WebView:', state);
    window.vscode.postMessage({ command: 'updateState', state: { nodes: nodesRef.current, edges: edgesRef.current } });
  }, [nodes, edges]);

  const markDirty = useCallback(() => {
    console.log('Marking canvas as dirty');
    window.vscode.postMessage({ command: 'markDirty' });
  }, []);

  const handleSave = useCallback(() => {
    console.log('Saving canvas state:', { nodes: nodesRef.current, edges: edgesRef.current });
    window.vscode.postMessage({
      command: 'saveState',
      state: { nodes: nodesRef.current, edges: edgesRef.current },
    });
  }, []);

  // const handleautoSave = useCallback(() => {
  //   console.log('Saving canvas state:', { nodes: nodesRef.current, edges: edgesRef.current });
  //   window.vscode.postMessage({
  //     command: 'autosave',
  //     state: { nodes: nodesRef.current, edges: edgesRef.current },
  //   });
  // }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => {
        const updatedNodes = applyNodeChanges(changes, nds);
        console.log('Nodes updated:', updatedNodes);
        markDirty();
        return updatedNodes;
      });
    },
    [markDirty]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => {
        const updatedEdges = applyEdgeChanges(changes, eds);
        console.log('Edges updated:', updatedEdges);
        markDirty();
        return updatedEdges;
      });
    },
    [markDirty]
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData('application/reactflow');
      const position = { x: event.clientX - 200, y: event.clientY - 50 };

      const newNode: Node = {
        id: `${nodeType}-${nodes.length + 1}`,
        type: 'default',
        position,
        data: { label: nodeType },
      };

      console.log('Node dropped:', newNode);

      setNodes((nds) => {
        const updatedNodes = [...nds, newNode];
        console.log('Nodes after drop:', updatedNodes);
        markDirty();
        return updatedNodes;
      });
    },
    [nodes, markDirty]
  );

  const onDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  return (
    <div className="canvas" onDrop={onDrop} onDragOver={onDragOver}>
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