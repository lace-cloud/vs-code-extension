const path = require('node:path');

module.exports = [
  {
    // Backend (Node.js) — host package
    entry: './packages/host/src/extension.ts',
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
    // inside @lace/canvas, so the published package is portable.
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
    // Frontend (Webview) — chat sidebar
    mode: 'development',
    entry: './packages/chat-sidebar/src/webview-entry.tsx',
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
];
