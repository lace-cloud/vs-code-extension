// src/chat/auto-connect.ts
//
// Pure function: score and select best output→input connections between
// two module instances. Extracted for testability.

import type { InputDef, OutputDef } from '../webview/types/ir';

export type ScoredMatch = {
  from: string; // output name
  to: string; // input name
  score: number;
};

/**
 * Score how well a source output matches a target input.
 * Returns 0 if no match.
 *
 * Scoring:
 *   100 — exact name match
 *    90 — suffix-stripped match (e.g., "vpc_id" matches "id" after stripping "vpc_")
 *    50 — substring match (one name contains the other)
 *    30 — type-compatible only (same type, no name overlap)
 */
export function scoreMatch(output: OutputDef, input: InputDef): number {
  const outName = output.name.toLowerCase();
  const inName = input.name.toLowerCase();
  const outType = output.type.toLowerCase();
  const inType = input.type.toLowerCase();

  // Exact name match
  if (outName === inName) return 100;

  // Suffix-stripped match: strip common prefixes like instance names
  // e.g., output "vpc_id" should match input "vpc_id" (already caught above)
  // or output "id" should match input "vpc_id" (substring)
  const outParts = outName.split('_');
  const inParts = inName.split('_');
  const outSuffix = outParts[outParts.length - 1];
  const inSuffix = inParts[inParts.length - 1];
  if (outParts.length > 1 && inParts.length > 1 && outSuffix === inSuffix) {
    return 90;
  }

  // Substring match
  if (outName.includes(inName) || inName.includes(outName)) {
    return 50;
  }

  // Type-compatible only
  if (outType === inType && outType !== '') {
    return 30;
  }

  return 0;
}

/**
 * Find the best non-conflicting set of connections between a source's outputs
 * and a target's unbound required inputs.
 *
 * Uses greedy selection: highest-scored matches first, each output and input
 * used at most once.
 */
export function findAutoConnections(
  sourceOutputs: OutputDef[],
  targetInputs: InputDef[],
  boundInputNames: Set<string>,
): ScoredMatch[] {
  // Only consider unbound required inputs
  const unboundInputs = targetInputs.filter(
    (inp) => inp.required && !boundInputNames.has(inp.name),
  );

  if (sourceOutputs.length === 0 || unboundInputs.length === 0) {
    return [];
  }

  // Score all pairs
  const allPairs: ScoredMatch[] = [];
  for (const out of sourceOutputs) {
    for (const inp of unboundInputs) {
      const score = scoreMatch(out, inp);
      if (score > 0) {
        allPairs.push({ from: out.name, to: inp.name, score });
      }
    }
  }

  // Sort by score descending
  allPairs.sort((a, b) => b.score - a.score);

  // Greedy non-conflicting selection
  const usedOutputs = new Set<string>();
  const usedInputs = new Set<string>();
  const selected: ScoredMatch[] = [];

  for (const pair of allPairs) {
    if (usedOutputs.has(pair.from) || usedInputs.has(pair.to)) continue;
    usedOutputs.add(pair.from);
    usedInputs.add(pair.to);
    selected.push(pair);
  }

  return selected;
}
