declare global {
  interface Window {
    vscode: {
      postMessage: (message: any) => void;
    };
    __canvasUndo?: () => void;
  }
}

export {};
