const path = require('node:path');
const { readdirSync } = require('node:fs');

// The window tests, one bundle each, for the extension host to load: each
// carries what it imports — the libraries and the extension's own modules —
// and takes `vscode` and Mocha's globals from the host.
const window = path.resolve(__dirname, 'window');
const tests = readdirSync(window).filter((file) => file.endsWith('.test.ts'));

module.exports = {
  name: 'window-tests',
  entry: Object.fromEntries(
    tests.map((file) => [file.replace(/\.ts$/, ''), path.join(window, file)]),
  ),
  output: {
    path: path.resolve(__dirname, 'out'),
    filename: '[name].js',
    library: { type: 'commonjs2' },
    clean: true,
  },
  target: 'node',
  resolve: { extensions: ['.ts', '.js'] },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        loader: 'builtin:swc-loader',
        options: { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' } },
        type: 'javascript/auto',
      },
    ],
  },
  externals: { vscode: 'commonjs vscode' },
  devtool: 'source-map',
};
