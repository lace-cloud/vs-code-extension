import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  tsconfig: './tsconfig.json',
  external: ['react', 'react-dom', '@lace/design-tokens'],
  injectStyle: false,
  loader: { '.css': 'copy' },
});
