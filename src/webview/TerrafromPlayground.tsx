import React, { useState, useCallback } from 'react';
import ReactFlow, { addEdge, Background, Controls, Edge, Connection } from 'react-flow-renderer';

const initialNodes = [
  { id: '1', type: 'input', data: { label: 'EC2 Instance' }, position: { x: 250, y: 5 } },
  { id: '2', type: 'output', data: { label: 'S3 Bucket' }, position: { x: 100, y: 100 } },
];

function TerraformPlayground() {
  const [edges, setEdges] = useState<Edge[]>([]);

  // Update onConnect to use Connection as the parameter type
  const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge(params, eds)), []);

  return (
    <div style={{ height: '100vh' }}>
      <ReactFlow nodes={initialNodes} edges={edges} onConnect={onConnect}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export default TerraformPlayground;
