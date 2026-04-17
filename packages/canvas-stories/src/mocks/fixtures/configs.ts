// Hand-authored NodeConfig + SettingsConfig fixtures used by panel +
// scene stories. Complements the captured CanvasView fixtures in the
// same directory — those come from the live CLI; these are realistic
// synthetic configs that exercise the config-panel state space.

import type { NodeConfig, SettingsConfig } from '@lace/proto';

// ── Module configs ───────────────────────────────────────────────────

/**
 * A realistic `aws/vpc` module config. Two required inputs (one already
 * set literally), two optional inputs (one unset), two outputs. No
 * siblings. Exercises the happy path — required + optional accordions,
 * literal editor, and the outputs view.
 */
export const vpcNodeConfig: NodeConfig = {
  instance_id: 'vpc',
  inputs: [
    {
      name: 'cidr_block',
      type: 'string',
      required: true,
      description: 'IPv4 CIDR block for the VPC.',
      mode: 'literal',
      value: '10.0.0.0/16',
    },
    {
      name: 'name',
      type: 'string',
      required: true,
      description: 'Human-readable VPC name.',
      mode: 'variable',
      variable: 'project_name',
    },
    {
      name: 'enable_dns_support',
      type: 'bool',
      required: false,
      default_value: true,
      mode: 'empty',
    },
    {
      name: 'tags',
      type: 'map(string)',
      required: false,
      description: 'Resource tags.',
      mode: 'empty',
    },
  ],
  outputs: [
    { name: 'vpc_id', type: 'string', description: 'The VPC ID.' },
    { name: 'cidr_block', type: 'string', description: 'The CIDR block the VPC was created with.' },
  ],
  sibling_ids: [],
  depends_on: [],
  available_variables: [
    { name: 'project_name', type: 'string' },
    { name: 'environment', type: 'string' },
  ],
};

/**
 * `attachment` config from the iam-stack fixture: two inputs already
 * wired (from iam_role.role_name and policy.policy_arn). Exercises the
 * "wired editor" + "disconnect" flow.
 */
export const attachmentNodeConfig: NodeConfig = {
  instance_id: 'attachment',
  inputs: [
    {
      name: 'role_name',
      type: 'string',
      required: true,
      description: 'Name of the IAM role to attach the policy to.',
      mode: 'wired',
      wired_source: 'iam_role.role_name',
    },
    {
      name: 'policy_arn',
      type: 'string',
      required: true,
      description: 'ARN of the policy to attach.',
      mode: 'wired',
      wired_source: 'policy.policy_arn',
    },
    {
      name: 'tags',
      type: 'map(string)',
      required: false,
      description: 'Resource tags.',
      mode: 'empty',
    },
  ],
  outputs: [{ name: 'id', type: 'string' }],
  sibling_ids: ['iam_role', 'policy'],
  depends_on: [],
  available_variables: [{ name: 'environment', type: 'string' }],
};

/**
 * A loading-state equivalent: empty inputs, empty outputs. Unused
 * directly — stories that want a loading state delay the promise
 * instead. Exported for completeness.
 */
export const emptyNodeConfig: NodeConfig = {
  instance_id: '',
  inputs: [],
  outputs: [],
  sibling_ids: [],
  depends_on: [],
  available_variables: [],
};

// ── Settings ─────────────────────────────────────────────────────────

/**
 * Populated `SettingsConfig` covering all four accordion sections in
 * UnifiedSettingsPanel. Used by SettingsOpen scene + the
 * UnifiedSettingsPanel panel story.
 */
export const populatedSettings: SettingsConfig = {
  terraform: {
    required_version: '>= 1.5',
    required_providers: [
      { name: 'aws', source: 'hashicorp/aws', version: '~> 5.0' },
      { name: 'random', source: 'hashicorp/random', version: '~> 3.5' },
    ],
  },
  providers: [
    {
      name: 'aws',
      alias: '',
      config: { region: 'us-west-2', default_tags: 'managed-by:lace' },
    },
    {
      name: 'aws',
      alias: 'east',
      config: { region: 'us-east-1' },
    },
  ],
  locals: [
    { name: 'environment', mode: 'literal', value_display: 'dev' },
    {
      name: 'common_tags',
      mode: 'expression',
      value_display: '{ managed_by = "lace", environment = var.environment }',
    },
  ],
  environments: {
    dev: { region: 'us-west-2', instance_count: 1 },
    prod: { region: 'us-east-1', instance_count: 3, enable_backups: true },
  },
};

export const emptySettings: SettingsConfig = {
  terraform: { required_version: '', required_providers: [] },
  providers: [],
  locals: [],
  environments: {},
};
