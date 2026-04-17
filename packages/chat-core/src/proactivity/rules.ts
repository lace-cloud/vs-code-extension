// Pure rule functions for between-turn proactivity suggestions.
// No vscode imports, no side effects — easy to unit test.
//
// Each rule: (event, prevState) => Suggestion | null
// Returning null means "nothing to suggest for this event."

import type { CanvasView, NodePin, RenderNode } from '@lace/host';
import type { ProactiveSuggestion } from '../protocol';

// ── Proto-shaped inputs ──
// Matches the shape of EngineEvent fields from packages/host/src/generated/service.ts.
// We accept plain objects so rules can be tested without importing gRPC types.

export type StateUpdatedLike = {
  view: CanvasView | undefined;
};

export type GenerateProgressLike = {
  stage: string;
  message: string;
};

export type GenerateSuccessLike = {
  files_written: string[];
  files: Record<string, string>;
};

export type GenerateErrorLike = {
  message: string;
  diagnostics: Array<{ message: string; instance_id?: string; address?: string }>;
};

export type EngineEventLike = {
  state_updated?: StateUpdatedLike;
  generate_progress?: GenerateProgressLike;
  generate_success?: GenerateSuccessLike;
  generate_error?: GenerateErrorLike;
};

export type RuleState = {
  prevErrorCount: number;
  prevNodeIds: Set<string>;
};

export function initialRuleState(): RuleState {
  return { prevErrorCount: 0, prevNodeIds: new Set() };
}

// ── Rule 1: unwired required input on newly added node ──
//
// Trigger: StateUpdated introduces a new node (id not in prevNodeIds).
// If that node has a required input with mode:'empty' and type_family matching
// some sibling's output type_family, suggest wiring.

export function matchUnwiredRequiredInput(
  event: EngineEventLike,
  state: RuleState,
): ProactiveSuggestion | null {
  const view = event.state_updated?.view;
  if (!view) return null;

  const newNodes = view.nodes.filter((n) => !state.prevNodeIds.has(n.id));
  if (newNodes.length === 0) return null;

  // Look at the first new node only — avoid suggestion spam on bulk drops.
  const newNode = newNodes[0];

  const unwiredRequiredInput = findUnwiredRequiredInput(newNode);
  if (!unwiredRequiredInput) return null;

  const candidate = findSiblingOutputMatch(view, newNode, unwiredRequiredInput);
  if (!candidate) return null;

  return {
    id: `unwired-${newNode.id}-${unwiredRequiredInput.name}`,
    text: `The new \`${newNode.id}\` has an unwired required input \`${unwiredRequiredInput.name}\`. Want me to wire it to \`${candidate.instanceId}.${candidate.outputName}\`?`,
  };
}

function findUnwiredRequiredInput(node: RenderNode): NodePin | null {
  for (const pin of node.inputs) {
    if (pin.required && !pin.wired) return pin;
  }
  return null;
}

function findSiblingOutputMatch(
  view: CanvasView,
  target: RenderNode,
  targetInput: NodePin,
): { instanceId: string; outputName: string } | null {
  const family = targetInput.type_family;
  if (!family) return null;

  for (const node of view.nodes) {
    if (node.id === target.id) continue;
    for (const output of node.outputs) {
      if (output.type_family === family) {
        return { instanceId: node.id, outputName: output.name };
      }
    }
  }
  return null;
}

// ── Rule 2: generation failed with diagnostics ──

export function matchGenerateError(event: EngineEventLike): ProactiveSuggestion | null {
  const err = event.generate_error;
  if (!err || err.diagnostics.length === 0) return null;

  const first = err.diagnostics[0];
  const location = first.instance_id
    ? `\`${first.instance_id}\`${first.address ? `.\`${first.address}\`` : ''}`
    : '';
  const locSuffix = location ? ` at ${location}` : '';
  return {
    id: `gen-error-${Date.now()}`,
    text: `Generation failed: ${first.message}${locSuffix}. Want me to look at it?`,
  };
}

// ── Rule 3: validation errors appeared (crossed 0 → N) ──

export function matchErrorsAppeared(
  event: EngineEventLike,
  state: RuleState,
): ProactiveSuggestion | null {
  const view = event.state_updated?.view;
  if (!view) return null;

  const curr = view.errors.length;
  if (state.prevErrorCount !== 0 || curr === 0) return null;

  const first = view.errors[0];
  const summary =
    first.message + (view.errors.length > 1 ? ` (+${view.errors.length - 1} more)` : '');
  return {
    id: `errors-appeared-${Date.now()}`,
    text: `${curr} validation error${curr === 1 ? '' : 's'} appeared — ${summary}. Investigate?`,
  };
}

// ── Dispatch ──

export function matchAll(event: EngineEventLike, state: RuleState): ProactiveSuggestion | null {
  return (
    matchUnwiredRequiredInput(event, state) ??
    matchGenerateError(event) ??
    matchErrorsAppeared(event, state)
  );
}

export function advanceState(event: EngineEventLike, state: RuleState): RuleState {
  const view = event.state_updated?.view;
  if (!view) return state;
  return {
    prevErrorCount: view.errors.length,
    prevNodeIds: new Set(view.nodes.map((n) => n.id)),
  };
}
