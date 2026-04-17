import type { CanvasView, RenderNode } from '@lace/host';
import { describe, expect, test } from 'vitest';
import {
  advanceState,
  type EngineEventLike,
  initialRuleState,
  matchAll,
  matchErrorsAppeared,
  matchGenerateError,
  matchUnwiredRequiredInput,
} from '../proactivity/rules';

function makeView(nodes: RenderNode[], errorCount = 0): CanvasView {
  return {
    module_name: 'root',
    nodes,
    edges: [],
    errors: Array.from({ length: errorCount }, (_, i) => ({ message: `err-${i}` })),
    can_undo: false,
    can_redo: false,
    is_dirty: false,
    groups: [],
  };
}

function makeNode(
  id: string,
  inputs: Array<{
    name: string;
    type: string;
    type_family?: string;
    required?: boolean;
    wired?: boolean;
  }> = [],
  outputs: Array<{ name: string; type: string; type_family?: string }> = [],
): RenderNode {
  return {
    id,
    label: id,
    kind: 'module',
    position: { x: 0, y: 0 },
    has_errors: false,
    error_messages: [],
    inputs,
    outputs,
  };
}

describe('proactivity rules', () => {
  describe('matchUnwiredRequiredInput', () => {
    test('returns null when no StateUpdated event', () => {
      const event: EngineEventLike = { generate_progress: { stage: 'validating', message: '' } };
      expect(matchUnwiredRequiredInput(event, initialRuleState())).toBeNull();
    });

    test('returns null when no new nodes', () => {
      const vpc = makeNode('vpc');
      const event: EngineEventLike = { state_updated: { view: makeView([vpc]) } };
      const state = initialRuleState();
      state.prevNodeIds = new Set(['vpc']);
      expect(matchUnwiredRequiredInput(event, state)).toBeNull();
    });

    test('suggests wire when new node has unwired required input with matching sibling output', () => {
      const vpc = makeNode('vpc', [], [{ name: 'vpc_id', type: 'string', type_family: 'string' }]);
      const subnet = makeNode(
        'subnet',
        [{ name: 'vpc_id', type: 'string', type_family: 'string', required: true, wired: false }],
        [],
      );
      const event: EngineEventLike = { state_updated: { view: makeView([vpc, subnet]) } };
      const state = initialRuleState();
      state.prevNodeIds = new Set(['vpc']); // subnet is the new node

      const result = matchUnwiredRequiredInput(event, state);
      expect(result).not.toBeNull();
      expect(result?.text).toContain('subnet');
      expect(result?.text).toContain('vpc_id');
      expect(result?.text).toContain('vpc.vpc_id');
    });

    test('returns null when required input is already wired', () => {
      const vpc = makeNode('vpc', [], [{ name: 'vpc_id', type: 'string', type_family: 'string' }]);
      const subnet = makeNode('subnet', [
        { name: 'vpc_id', type: 'string', type_family: 'string', required: true, wired: true },
      ]);
      const event: EngineEventLike = { state_updated: { view: makeView([vpc, subnet]) } };
      const state = initialRuleState();
      state.prevNodeIds = new Set(['vpc']);
      expect(matchUnwiredRequiredInput(event, state)).toBeNull();
    });

    test('returns null when no sibling has matching type_family', () => {
      const vpc = makeNode('vpc', [], [{ name: 'vpc_id', type: 'string', type_family: 'string' }]);
      const subnet = makeNode('subnet', [
        { name: 'cidr', type: 'string', type_family: 'cidr', required: true },
      ]);
      const event: EngineEventLike = { state_updated: { view: makeView([vpc, subnet]) } };
      const state = initialRuleState();
      state.prevNodeIds = new Set(['vpc']);
      expect(matchUnwiredRequiredInput(event, state)).toBeNull();
    });
  });

  describe('matchGenerateError', () => {
    test('returns null when no generate_error field', () => {
      expect(matchGenerateError({ state_updated: { view: makeView([]) } })).toBeNull();
    });

    test('returns null when diagnostics is empty', () => {
      expect(matchGenerateError({ generate_error: { message: '', diagnostics: [] } })).toBeNull();
    });

    test('suggests investigation with location when diagnostic has instance_id', () => {
      const result = matchGenerateError({
        generate_error: {
          message: 'failed',
          diagnostics: [{ message: 'bad value', instance_id: 'vpc', address: 'cidr' }],
        },
      });
      expect(result).not.toBeNull();
      expect(result?.text).toContain('bad value');
      expect(result?.text).toContain('vpc');
      expect(result?.text).toContain('cidr');
    });

    test('handles diagnostic without location', () => {
      const result = matchGenerateError({
        generate_error: { message: 'failed', diagnostics: [{ message: 'syntax error' }] },
      });
      expect(result).not.toBeNull();
      expect(result?.text).toContain('syntax error');
    });
  });

  describe('matchErrorsAppeared', () => {
    test('returns null when prevErrorCount is non-zero', () => {
      const event: EngineEventLike = { state_updated: { view: makeView([], 3) } };
      const state = { ...initialRuleState(), prevErrorCount: 2 };
      expect(matchErrorsAppeared(event, state)).toBeNull();
    });

    test('returns null when current errors is zero', () => {
      const event: EngineEventLike = { state_updated: { view: makeView([], 0) } };
      expect(matchErrorsAppeared(event, initialRuleState())).toBeNull();
    });

    test('fires when errors cross 0 → N', () => {
      const event: EngineEventLike = { state_updated: { view: makeView([], 2) } };
      const result = matchErrorsAppeared(event, initialRuleState());
      expect(result).not.toBeNull();
      expect(result?.text).toContain('2 validation error');
      expect(result?.text).toContain('err-0');
    });
  });

  describe('advanceState', () => {
    test('updates prevErrorCount and prevNodeIds from view', () => {
      const vpc = makeNode('vpc');
      const subnet = makeNode('subnet');
      const event: EngineEventLike = { state_updated: { view: makeView([vpc, subnet], 3) } };
      const newState = advanceState(event, initialRuleState());
      expect(newState.prevErrorCount).toBe(3);
      expect([...newState.prevNodeIds]).toEqual(['vpc', 'subnet']);
    });

    test('returns unchanged state when no view', () => {
      const state = { ...initialRuleState(), prevErrorCount: 5 };
      const result = advanceState({ generate_progress: { stage: 'x', message: '' } }, state);
      expect(result).toBe(state);
    });
  });

  describe('matchAll', () => {
    test('dispatches to first matching rule', () => {
      const vpc = makeNode('vpc', [], [{ name: 'vpc_id', type: 'string', type_family: 'string' }]);
      const subnet = makeNode('subnet', [
        { name: 'vpc_id', type: 'string', type_family: 'string', required: true, wired: false },
      ]);
      const event: EngineEventLike = { state_updated: { view: makeView([vpc, subnet]) } };
      const state = initialRuleState();
      state.prevNodeIds = new Set(['vpc']);
      const result = matchAll(event, state);
      expect(result?.id).toContain('unwired-subnet');
    });

    test('returns null when no rule matches', () => {
      const event: EngineEventLike = { state_updated: { view: makeView([makeNode('vpc')]) } };
      expect(matchAll(event, initialRuleState())).toBeNull();
    });
  });
});
