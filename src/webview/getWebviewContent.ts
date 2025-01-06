// import * as vscode from 'vscode';
// import * as path from 'path';

// export function getWebviewContent(
//   context: vscode.ExtensionContext,
//   webview: vscode.Webview,
//   ec2Uri: vscode.Uri,
//   s3Uri: vscode.Uri,
//   lambdaUri: vscode.Uri
// ): string {
//   const reactAppPath = vscode.Uri.file(
//     path.join(context.extensionPath, 'out', 'webview.js') // Adjusted to 'out'
//   );
//   const reactAppUri = webview.asWebviewUri(reactAppPath);

//   return `
//     <!DOCTYPE html>
//     <html lang="en">
//     <head>
//       <meta charset="UTF-8">
//       <title>Terraform Playground</title>
//     </head>
//     <body>
//       <div id="root"></div>
//       <script>
//         window.iconPaths = {
//           ec2: "${ec2Uri}",
//           s3: "${s3Uri}",
//           lambda: "${lambdaUri}"
//         };
//       </script>
//       <script src="${reactAppUri}"></script>
//     </body>
//     </html>
//   `;
// }

///////////////////////////////////////////////////

import * as vscode from 'vscode';
import * as path from 'path';


export function getWebviewContent(
    context: vscode.ExtensionContext,
    webview: vscode.Webview,
    ec2Uri: vscode.Uri,
    s3Uri: vscode.Uri,
    lambdaUri: vscode.Uri,
  ): string {
    const reactAppPath = vscode.Uri.file(
        path.join(context.extensionPath, 'out', 'webview.js')
    );
    const reactAppUri = webview.asWebviewUri(reactAppPath);
  
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Lace</title>
        <style>
          body {
            margin: 0;
            padding: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
          }
          
  
          #menu-bar {
            display: flex;
            justify-content: start;
            background-color: #333;
            color: white;
            padding: 5px;
            position: relative;
          }
  
          #menu-bar .menu-item {
            position: relative;
            padding: 10px 15px;
            cursor: pointer;
          }
  
          #menu-bar .menu-item:hover {
            background-color: #444;
          }
  
          #menu-bar .submenu {
            display: none;
            position: absolute;
            top: 100%;
            left: 0;
            background-color: #333;
            border: 1px solid #444;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.5);
            z-index: 100;
          }
  
          #menu-bar .menu-item:hover .submenu {
            display: block;
          }
  
          #menu-bar .submenu .submenu-item {
            padding: 8px 15px;
            text-align: left;
            color: white;
            cursor: pointer;
            white-space: nowrap;
          }
  
          #menu-bar .submenu .submenu-item:hover {
            background-color: #555;
          }
        </style>
      </head>
      <body>
  
      
        <div id="menu-bar">
          <!-- File Menu -->
          <div class="menu-item">
            File
            <div class="submenu">
              <div class="submenu-item" onclick="handleSubmenuClick('embed')">Embed</div>
              <div class="submenu-item" onclick="handleSubmenuClick('page-setup')">Page Setup</div>
              <div class="submenu-item" onclick="handleSubmenuClick('properties')">Properties</div>
              <div class="submenu-item" onclick="handleSubmenuClick('import')">Import</div>
              <div class="submenu-item" onclick="handleSubmenuClick('export')">Export</div>
              <div class="submenu-item" onclick="handleSubmenuClick('save')">Save</div>
            </div>
          </div>
  
          <!-- Other Menus -->
          <div class="menu-item" onclick="handleMenuClick('edit')">Edit</div>
          <div class="menu-item" onclick="handleMenuClick('view')">View</div>
          <div class="menu-item" onclick="handleMenuClick('arrange')">Arrange</div>
          <div class="menu-item" onclick="handleMenuClick('extras')">Extras</div>
        </div>
  
        <div id="root"></div>
  
        
  
        <script>
  
          // Ensure acquireVsCodeApi is called only once
          if (!window.vscode) {
            console.log("Initializing VS Code API...");
            window.vscode = acquireVsCodeApi();
          } else {
            console.log("VS Code API already initialized.");
          }
          console.log("Window.vscode initialized:", window.vscode);
  
          let currentCanvasState = { nodes: [], edges: [] };
  
          window.addEventListener('message', (event) => {
                const { command, state } = event.data;
                console.log('Message received:', event.data);
                if (command === 'updateState') {
                  console.log('Updating currentCanvasState:', state);
                  currentCanvasState = state || { nodes: [], edges: [] };
                }
              });
  
          
          
  
          function handleSubmenuClick(action) {
            if (action === 'save') {
              
              console.log('Saving current canvas state:', currentCanvasState);
              window.vscode.postMessage({ command: 'saveState', state: currentCanvasState });
            }
          }
        </script>
  
        <script>
          const iconPaths = {
            ec2: "${ec2Uri}",
            s3: "${s3Uri}",
            lambda: "${lambdaUri}"
          };
          window.iconPaths = iconPaths;
          console.log('Image paths passed to React app:', window.iconPaths);
        </script>
  
        <script src="${reactAppUri}"></script>
      </body>
      </html>
    `;
  }
