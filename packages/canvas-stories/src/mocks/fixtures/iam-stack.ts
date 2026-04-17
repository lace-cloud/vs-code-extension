// Captured from `lace engine -tags=test` via scripts/capture-fixtures.mjs.
// Regenerate with: pnpm run capture-fixtures
import type { CanvasView } from '@lace/proto';

export const iamStackFixture: CanvasView = {
  module_name: 'iam-stack',
  nodes: [
    {
      id: 'iam_role',
      label: 'iam_role',
      kind: 'module',
      position: {
        x: 0,
        y: 0,
      },
      has_errors: false,
      error_messages: [],
      inputs: [],
      outputs: [
        {
          name: 'role_arn',
          type: 'any',
        },
        {
          name: 'role_name',
          type: 'any',
          wired: true,
        },
      ],
      module_key: 'aws/iam/role@v1.0.0',
    },
    {
      id: 'policy',
      label: 'policy',
      kind: 'module',
      position: {
        x: 260,
        y: 0,
      },
      has_errors: false,
      error_messages: [],
      inputs: [],
      outputs: [
        {
          name: 'policy_arn',
          type: 'any',
          wired: true,
        },
      ],
      module_key: 'aws/iam/policy@v1.0.0',
    },
    {
      id: 'attachment',
      label: 'attachment',
      kind: 'module',
      position: {
        x: 0,
        y: 180,
      },
      has_errors: false,
      error_messages: [],
      inputs: [],
      outputs: [],
      module_key: 'aws/iam/policy_attachment@v1.0.0',
    },
  ],
  edges: [
    {
      id: 'iam_role-attachment-role_name-role_name',
      source: 'iam_role',
      target: 'attachment',
      source_output: 'role_name',
      target_input: 'role_name',
    },
    {
      id: 'policy-attachment-policy_arn-policy_arn',
      source: 'policy',
      target: 'attachment',
      source_output: 'policy_arn',
      target_input: 'policy_arn',
    },
  ],
  errors: [],
  can_undo: false,
  can_redo: false,
  is_dirty: true,
  groups: [],
};
