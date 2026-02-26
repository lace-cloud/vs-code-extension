import { describe, test, expect } from 'vitest';
import { fromBundle, toBundle } from '../utils/bundle';
import { workspaceReducer } from '../state/reducer';
import { validateWorkspace } from '../utils/validate';
import type { ModuleBundle } from '../types/ir';
import type { WorkspaceState } from '../types/workspace';
import { loadFixture, makeEmptyWorkspace } from './helpers';

function dropBundle(fixture: ModuleBundle): WorkspaceState {
  return workspaceReducer(makeEmptyWorkspace(), {
    type: 'DROP_BUNDLE',
    module_key: 'root@v1.0.0',
    deploy_bundle: fixture,
    positions: {},
  });
}

// ══════════════════════════════════════════════════════════════════════
// IAM stack consistency
// ══════════════════════════════════════════════════════════════════════

describe('IAM stack consistency', () => {
  describe('full iam_stack bundle', () => {
    const fixture = loadFixture('iam_stack_deploy_bundle.json');

    test('fromBundle parses without errors', () => {
      const { errors } = fromBundle(fixture);
      expect(errors).toHaveLength(0);
    });

    test('round-trip: fromBundle → toBundle → fromBundle preserves modules', () => {
      const { workspace } = fromBundle(fixture);
      const exported = toBundle(workspace);
      const { workspace: reimported, errors } = fromBundle(exported);
      expect(errors).toHaveLength(0);
      expect(reimported.modules).toEqual(workspace.modules);
    });

    test('DROP_BUNDLE merges 4 non-entry modules', () => {
      const next = dropBundle(fixture);
      expect(next.modules['cloudwatch-logs-policy@v1.0.0']).toBeDefined();
      expect(next.modules['aws-iam-role@v1.0.0']).toBeDefined();
      expect(next.modules['aws-iam-policy@v1.0.0']).toBeDefined();
      expect(next.modules['aws-iam-policy-attachment@v1.0.0']).toBeDefined();
      // Entry wrapper NOT merged
      expect(next.modules['iam-stack@v1.0.0']).toBeUndefined();
    });

    test('flattenInstances resolves nested composite to 3 leaf instances', () => {
      const next = dropBundle(fixture);
      const instances = next.modules['root@v1.0.0'].graph.instances;
      expect(instances).toHaveLength(3);
      expect(instances.find((i) => i.id === 'iam_role')).toBeDefined();
      expect(instances.find((i) => i.id === 'policy')).toBeDefined();
      expect(instances.find((i) => i.id === 'attachment')).toBeDefined();
    });

    test('flattening resolves var bindings through composite interface', () => {
      const next = dropBundle(fixture);
      const instances = next.modules['root@v1.0.0'].graph.instances;
      const policy = instances.find((i) => i.id === 'policy')!;
      const attachment = instances.find((i) => i.id === 'attachment')!;

      // policy.policy_name was { var: "policy_name" } in the sub-composite,
      // resolved through cloudwatch_logs_policy's input { lit: "cloudwatch-logs" }
      expect(policy.inputs.policy_name).toEqual({ lit: 'cloudwatch-logs' });

      // attachment.role_name was { var: "role_name" } in the sub-composite,
      // resolved through cloudwatch_logs_policy's input { out: iam_role.role_name }
      expect(attachment.inputs.role_name).toEqual({
        out: { module: 'iam_role', name: 'role_name' },
      });
    });

    test('toBundle derives 2 wires from out bindings', () => {
      const next = dropBundle(fixture);
      const exported = toBundle(next);
      const wires = exported.modules['root@v1.0.0'].graph.wires!;
      expect(wires).toHaveLength(2);
      expect(wires).toContainEqual({
        from: { module: 'iam_role', port: 'outputs.role_name' },
        to: { module: 'attachment', port: 'inputs.role_name' },
      });
      expect(wires).toContainEqual({
        from: { module: 'policy', port: 'outputs.policy_arn' },
        to: { module: 'attachment', port: 'inputs.policy_arn' },
      });
    });

    test('validateWorkspace passes on the built workspace', () => {
      const next = dropBundle(fixture);
      expect(validateWorkspace(next)).toHaveLength(0);
    });
  });

  describe('policy_attachment bundle', () => {
    const fixture = loadFixture('policy_attachment_deploy_bundle.json');

    test('fromBundle parses without errors', () => {
      const { errors } = fromBundle(fixture);
      expect(errors).toHaveLength(0);
    });

    test('round-trip: fromBundle → toBundle → fromBundle preserves modules', () => {
      const { workspace } = fromBundle(fixture);
      const exported = toBundle(workspace);
      const { workspace: reimported, errors } = fromBundle(exported);
      expect(errors).toHaveLength(0);
      expect(reimported.modules).toEqual(workspace.modules);
    });

    test('DROP_BUNDLE merges 2 non-entry modules', () => {
      const next = dropBundle(fixture);
      expect(next.modules['aws-iam-policy@v1.0.0']).toBeDefined();
      expect(next.modules['aws-iam-policy-attachment@v1.0.0']).toBeDefined();
      // Entry wrapper NOT merged
      expect(next.modules['cloudwatch-logs-policy@v1.0.0']).toBeUndefined();
    });

    test('DROP_BUNDLE inlines 2 leaf instances', () => {
      const next = dropBundle(fixture);
      const instances = next.modules['root@v1.0.0'].graph.instances;
      expect(instances).toHaveLength(2);
      expect(instances.find((i) => i.id === 'policy')).toBeDefined();
      expect(instances.find((i) => i.id === 'attachment')).toBeDefined();
    });

    test('toBundle derives 1 wire (policy → attachment)', () => {
      const next = dropBundle(fixture);
      const exported = toBundle(next);
      const wires = exported.modules['root@v1.0.0'].graph.wires!;
      expect(wires).toHaveLength(1);
      expect(wires[0]).toEqual({
        from: { module: 'policy', port: 'outputs.policy_arn' },
        to: { module: 'attachment', port: 'inputs.policy_arn' },
      });
    });

    test('validateWorkspace passes on the built workspace', () => {
      const next = dropBundle(fixture);
      expect(validateWorkspace(next)).toHaveLength(0);
    });
  });

  test('both bundles produce valid workspaces with identical validation results', () => {
    const iamWs = dropBundle(loadFixture('iam_stack_deploy_bundle.json'));
    const policyWs = dropBundle(loadFixture('policy_attachment_deploy_bundle.json'));

    const iamErrors = validateWorkspace(iamWs);
    const policyErrors = validateWorkspace(policyWs);
    expect(iamErrors).toHaveLength(0);
    expect(policyErrors).toHaveLength(0);
  });
});
