declare global {
  interface Window {
    vscode: {
      postMessage: (message: any) => void;
    };
    __canvasDispatch?: (action: any) => void;
    __activeModuleKey?: string;
  }
}

export {};
