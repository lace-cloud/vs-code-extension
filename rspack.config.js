const path = require('node:path');

module.exports = [
  {
    // Backend (Node.js) — extension activation. Entry lives at the
    // extension root; vscode-coupled host primitives (panel classes,
    // webview-html builder, RPC-error UI) live in src/vscode/.
    // @lace-cloud/host is pure library code (transport, server-manager,
    // proto-gen) — no vscode side effects.
    entry: './src/extension.ts',
    output: {
      path: path.resolve(__dirname, 'out'),
      filename: 'extension.js',
      libraryTarget: 'commonjs2',
    },
    target: 'node',
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: {
            loader: 'ts-loader',
            options: {
              configFile: path.resolve(__dirname, 'tsconfig.json'),
              compilerOptions: { noEmit: false },
            },
          },
          exclude: /node_modules/,
        },
      ],
    },
    externals: {
      vscode: 'commonjs vscode',
    },
    devtool: 'source-map',
  },
  {
    // Frontend (Webview) — canvas. Entry lives at extension root, not
    // inside @lace-cloud/canvas, so the published package is portable.
    mode: 'development',
    entry: './src/canvas-webview-entry.tsx',
    output: {
      path: path.resolve(__dirname, 'out'),
      filename: 'webview.js',
    },
    target: 'web',
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: {
            loader: 'ts-loader',
            options: {
              configFile: path.resolve(__dirname, 'tsconfig.json'),
              compilerOptions: { noEmit: false },
            },
          },
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader', 'postcss-loader'],
        },
      ],
    },
    optimization: {
      runtimeChunk: false,
      splitChunks: false,
    },

    experiments: {
      css: false,
    },
    devtool: 'source-map',
  },
  {
    // Frontend (Webview) — chat sidebar. Entry lives at extension
    // root (mirrors canvas-webview-entry); @lace-cloud/chat-webview is pure
    // React, host-agnostic.
    mode: 'development',
    entry: './src/chat-webview-entry.tsx',
    output: {
      path: path.resolve(__dirname, 'out'),
      filename: 'chat-sidebar.js',
    },
    target: 'web',
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: {
            loader: 'ts-loader',
            options: {
              configFile: path.resolve(__dirname, 'tsconfig.json'),
              compilerOptions: { noEmit: false },
            },
          },
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader', 'postcss-loader'],
        },
      ],
    },
    optimization: {
      runtimeChunk: false,
      splitChunks: false,
    },

    experiments: {
      css: false,
    },
    devtool: 'source-map',
  },
  {
    // Frontend (Webview) — deploy panel. Form-shaped UI (stack picker,
    // apply button, status card); no React dependency, but built through
    // the same rspack pipeline so the shared webview-html scaffold can
    // reference out/deploy-webview.js by filename.
    mode: 'development',
    entry: './src/deploy-webview-entry.ts',
    output: {
      path: path.resolve(__dirname, 'out'),
      filename: 'deploy-webview.js',
    },
    target: 'web',
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: {
            loader: 'ts-loader',
            options: {
              configFile: path.resolve(__dirname, 'tsconfig.json'),
              compilerOptions: { noEmit: false },
            },
          },
          exclude: /node_modules/,
        },
      ],
    },
    optimization: {
      runtimeChunk: false,
      splitChunks: false,
    },
    experiments: {
      css: false,
    },
    devtool: 'source-map',
  },
];
