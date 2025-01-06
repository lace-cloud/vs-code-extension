declare const acquireVsCodeApi: () => {
    postMessage: (message: any) => void;
    getState: () => any;
    setState: (state: any) => void;
  };
  
  let vscodeApi: ReturnType<typeof acquireVsCodeApi> | undefined;
  
  export function getVsCodeApi() {
    if (!vscodeApi) {
      vscodeApi = acquireVsCodeApi(); // Call acquireVsCodeApi only once
      console.log("VS Code API initialized.");
      console.log("Acquiring VS Code API...");

    } else {
      console.log("Reusing existing VS Code API instance.");
    }
    return vscodeApi;
  }