// `engine-binary.mjs`: the engine for the repository at `repository`, the
// binary `named` when a run names one, or why there is none.
export function releasedEngine(
  repository: string,
  named?: string,
): { binary: string } | { refusal: string };
