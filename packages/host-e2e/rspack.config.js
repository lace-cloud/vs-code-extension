const path = require('node:path');
const { readdirSync } = require('node:fs');

// The window tests, one bundle each under the suite's directory in `out/`,
// for the extension host to load: each carries what it imports — the
// libraries and the extension's own modules — and takes `vscode` and
// Mocha's globals from the host. `window/` runs in a workspace whose tests
// make their modules; `empty/` in one that holds no Terraform.
const SUITES = ['window', 'empty'];
const entry = Object.fromEntries(
  SUITES.flatMap((suite) => {
    const directory = path.resolve(__dirname, suite);
    return readdirSync(directory)
      .filter((file) => file.endsWith('.test.ts'))
      .map((file) => [`${suite}/${file.replace(/\.ts$/, '')}`, path.join(directory, file)]);
  }),
);

module.exports = {
  name: 'window-tests',
  entry,
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
