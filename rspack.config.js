const path = require('node:path');

const out = path.resolve(__dirname, 'out');

const typescript = (jsx) => ({
  test: /\.tsx?$/,
  exclude: /node_modules/,
  loader: 'builtin:swc-loader',
  options: {
    jsc: {
      parser: { syntax: 'typescript', tsx: jsx },
      transform: jsx ? { react: { runtime: 'automatic' } } : undefined,
      target: 'es2022',
    },
  },
  type: 'javascript/auto',
});

module.exports = [
  {
    // The extension host bundle (Node). It imports `@lace-cloud/host` and the
    // React-free `@lace-cloud/canvas/engine`, never the canvas barrel.
    name: 'extension',
    entry: './src/extension.ts',
    output: {
      path: out,
      filename: 'extension.js',
      library: { type: 'commonjs2' },
    },
    target: 'node',
    resolve: { extensions: ['.ts', '.js'] },
    module: { rules: [typescript(false)] },
    externals: { vscode: 'commonjs vscode' },
    devtool: 'source-map',
  },
  {
    // The webview bundles (browser): each page one script and one
    // stylesheet — the canvas, the registry sidebar and module detail.
    name: 'canvas-webview',
    entry: {
      'canvas-webview': './src/canvas-webview/entry.tsx',
      'registry-sidebar': './src/registry-webview/sidebar-page.tsx',
      'module-detail': './src/registry-webview/detail-page.tsx',
    },
    output: {
      path: out,
      filename: '[name].js',
      cssFilename: '[name].css',
    },
    target: 'web',
    resolve: { extensions: ['.ts', '.tsx', '.js', '.jsx'] },
    module: { rules: [typescript(true)] },
    experiments: { css: true },
    optimization: { runtimeChunk: false, splitChunks: false },
    performance: false,
    devtool: 'source-map',
  },
];
