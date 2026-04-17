import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  tsconfig: './tsconfig.json',
  external: ['react', 'react-dom', '@lace/chat-core', '@lace/design-tokens'],
  // styles.css is published as a separate subpath. Copy from src/ into
  // dist/ so publishConfig.exports./styles.css resolves to ./dist/styles.css.
  onSuccess: async () => {
    copyFileSync(resolve('src/styles.css'), resolve('dist/styles.css'));
  },
});
