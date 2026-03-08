declare global {
  function acquireVsCodeApi(): {
    postMessage(msg: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
  };

  interface Window {
    __canvasUndo?: () => void;
  }
}

export {};
