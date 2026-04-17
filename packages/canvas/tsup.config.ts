import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  tsconfig: './tsconfig.json',
  external: [
    'react',
    'react-dom',
    '@xyflow/react',
    '@lace/proto',
    '@lace/ui',
    '@bufbuild/protobuf',
  ],
  injectStyle: false,
  loader: { '.css': 'copy' },
});
