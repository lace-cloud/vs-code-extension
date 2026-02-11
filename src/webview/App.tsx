
import React from 'react';
import Canvas from './Canvas';

declare global {
  interface Window {
    vscode: {
      postMessage: (msg: any) => void;
    };
  }
}

const App: React.FC = () => {
  return <Canvas />;
};

export default App;
