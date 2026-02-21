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
          use: {
            loader: 'ts-loader',
            options: {
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
          use: {
            loader: 'ts-loader',
            options: {
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
