import type { StorybookConfig } from 'storybook-react-rsbuild';
import { pluginReact } from '@rsbuild/plugin-react';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  framework: 'storybook-react-rsbuild',
  typescript: {
    check: false,
    reactDocgen: false,
  },
  // Expose env vars prefixed with STORYBOOK_ to the browser bundle.
  // Flow stories read STORYBOOK_LACE_ENGINE_URL + STORYBOOK_LACE_ENGINE_TOKEN
  // set by scripts/dev-storybook.sh after the CLI handshake.
  env: (cfg) => ({
    ...cfg,
    STORYBOOK_LACE_ENGINE_URL: process.env.STORYBOOK_LACE_ENGINE_URL ?? '',
    STORYBOOK_LACE_ENGINE_TOKEN: process.env.STORYBOOK_LACE_ENGINE_TOKEN ?? '',
  }),
  rsbuildFinal: async (cfg) => ({
    ...cfg,
    plugins: [...(cfg.plugins ?? []), pluginReact()],
    resolve: {
      ...cfg.resolve,
      alias: {
        ...(cfg.resolve?.alias as Record<string, string> | undefined),
        '@lace/canvas': path.resolve(here, '../../canvas/src'),
        '@lace/proto': path.resolve(here, '../../proto/src'),
        '@lace/design-tokens': path.resolve(here, '../../design-tokens'),
      },
    },
  }),
};

export default config;
