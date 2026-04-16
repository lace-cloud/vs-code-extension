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
  rsbuildFinal: async (cfg) => ({
    ...cfg,
    plugins: [...(cfg.plugins ?? []), pluginReact()],
    source: {
      ...cfg.source,
      alias: {
        ...(cfg.source?.alias as Record<string, string> | undefined),
        '@lace/canvas': path.resolve(here, '../../canvas/src'),
        '@lace/design-tokens': path.resolve(here, '../../design-tokens'),
      },
    },
  }),
};

export default config;
