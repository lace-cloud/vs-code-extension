// // src/webview/App.tsx
// import React, { useEffect, useState } from 'react';
// import Sidebar, { RegistryTree } from './Sidebar';
// import Canvas from './Canvas';

// declare global {
//   interface Window {
//     vscode: {
//       postMessage: (msg: any) => void;
//     };
//   }
// }

// const App: React.FC = () => {
//   const [registryTree, setRegistryTree] = useState<RegistryTree>({});

//   useEffect(() => {
//     const handler = (event: MessageEvent) => {
//       const msg = event.data;

//       if (msg.command === 'registryList') {
//         // ✅ modules is ALREADY a tree
//         setRegistryTree(msg.modules ?? {});
//       }
//     };

//     window.addEventListener('message', handler);
//     window.vscode.postMessage({ command: 'webviewReady' });

//     return () => window.removeEventListener('message', handler);
//   }, []);

//   return (
//     <div className="app">
//       {/* <Sidebar registry={registryTree} /> */}
//       <Canvas />
//     </div>
//   );
// };

// export default App;

// src/webview/App.tsx
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
