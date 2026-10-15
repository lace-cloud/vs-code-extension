// `engine-binary.mjs`: the engine for the repository at `repository`, the
// binary `named` when a run names one, or why there is none, said for the
// developer's OS (`platform`, the running one unless a caller names one).
export function releasedEngine(
  repository: string,
  named?: string,
  platform?: NodeJS.Platform,
): { binary: string } | { refusal: string };
