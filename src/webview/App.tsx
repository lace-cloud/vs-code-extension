import React from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import ErrorBoundary from './components/ErrorBoundary';
import Canvas from './Canvas';

export default function App() {
  return (
    <ErrorBoundary>
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
    </ErrorBoundary>
  );
}
