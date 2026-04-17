// Captured from `lace engine -tags=test` via scripts/capture-fixtures.mjs.
// Regenerate with: pnpm run capture-fixtures
import type { CanvasView } from '@lace/proto';

export const collapsedGroupFixture: CanvasView = {
  module_name: 'wired-stack',
  nodes: [
    {
      id: 'resource.aws_iam_role.this',
      label: 'resource.aws_iam_role.this',
      kind: 'resource',
      position: {
        x: 0,
        y: 0,
      },
      has_errors: false,
      error_messages: [],
      inputs: [],
      outputs: [],
    },
    {
      id: 'resource.aws_iam_policy.this',
      label: 'resource.aws_iam_policy.this',
      kind: 'resource',
      position: {
        x: 0,
        y: 0,
      },
      has_errors: false,
      error_messages: [],
      inputs: [],
      outputs: [],
    },
    {
      id: 'resource.aws_iam_role_policy_attachment.this',
      label: 'resource.aws_iam_role_policy_attachment.this',
      kind: 'resource',
      position: {
        x: 0,
        y: 0,
      },
      has_errors: false,
      error_messages: [],
      inputs: [],
      outputs: [],
    },
  ],
  edges: [
    {
      id: 'resource.aws_iam_policy.this-resource.aws_iam_role_policy_attachment.this-policy_arn-policy_arn',
      source: 'resource.aws_iam_policy.this',
      target: 'resource.aws_iam_role_policy_attachment.this',
      source_output: 'policy_arn',
      target_input: 'policy_arn',
    },
    {
      id: 'resource.aws_iam_role.this-resource.aws_iam_role_policy_attachment.this-role_name-role_name',
      source: 'resource.aws_iam_role.this',
      target: 'resource.aws_iam_role_policy_attachment.this',
      source_output: 'role_name',
      target_input: 'role_name',
    },
  ],
  errors: [],
  can_undo: false,
  can_redo: false,
  is_dirty: true,
  groups: [
    {
      id: 'g_wired_stack_fixture',
      label: 'IAM stack',
      node_ids: [
        'resource.aws_iam_policy.this',
        'resource.aws_iam_role.this',
        'resource.aws_iam_role_policy_attachment.this',
      ],
      collapsed: true,
    },
  ],
};
