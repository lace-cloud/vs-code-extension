declare global {
  interface Window {
    vscode: {
      postMessage: (message: any) => void;
    };
    iconPaths: { [key: string]: string };
  }
}

export {};
