// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

module.exports = [
  {
    // Backend (Node.js)
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
          use: 'ts-loader',
          exclude: /node_modules/,
        },
      ],
    },
    externals: {
      vscode: 'commonjs vscode',
      sqlite3: 'commonjs sqlite3', // Exclude SQLite3 from bundling
    },
    devtool: 'source-map',
  },
  {
    // Frontend (Webview)
    entry: './src/webview/index.tsx',
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
          use: 'ts-loader',
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
