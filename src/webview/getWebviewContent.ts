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

function getNonce() {
  return Math.random().toString(36).substring(2, 15);
}

export function getWebviewContent(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  ec2Uri: vscode.Uri,
  s3Uri: vscode.Uri,
  lambdaUri: vscode.Uri
): string {
  const nonce = getNonce();

  const reactAppUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'out', 'webview.js'))
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />

  <!-- ✅ FINAL, CORRECT CSP -->
  <meta
    http-equiv="Content-Security-Policy"
    content="
      default-src 'none';
      img-src ${webview.cspSource} data:;
      style-src ${webview.cspSource} 'unsafe-inline';
      script-src 'nonce-${nonce}';
      connect-src ${webview.cspSource};
    "
  />


  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Lace</title>

  <style>
    body {
      margin: 0;
      padding: 0;
      height: 100vh;
      background: #1e1e1e;
      display: flex;
      flex-direction: column;
    }

    #menu-bar {
      display: flex;
      background: #333;
      color: white;
      padding: 6px 10px;
      font-size: 13px;
    }

    .menu-item {
      margin-right: 16px;
      cursor: pointer;
    }

    .menu-item:hover {
      background: #444;
    }
  </style>
</head>

<body>
  <div id="menu-bar">
    <div class="menu-item">File</div>
    <div class="menu-item">Edit</div>
    <div class="menu-item">View</div>
  </div>

  <div id="root"></div>

  <script nonce="${nonce}">
    // window.vscode = acquireVsCodeApi();

    window.iconPaths = {
      ec2: "${ec2Uri}",
      s3: "${s3Uri}",
      lambda: "${lambdaUri}"
    };

    // window.vscode.postMessage({ command: 'webviewReady' });
  </script>

  <script nonce="${nonce}" src="${reactAppUri}"></script>
</body>
</html>`;
}
