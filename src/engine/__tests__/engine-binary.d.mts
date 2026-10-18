// `engine-binary.mjs`: the release `LACE_CLI_VERSION` names in the
// repository at `repository`, as CI reads it.
export function pinnedVersion(repository: string): string;

// `engine-binary.mjs`: the engine for the repository at `repository`, the
// binary `named` when a run names one, or why there is none, said for the
// developer's OS (`platform`, the running one unless a caller names one).
export function releasedEngine(
  repository: string,
  named?: string,
  platform?: NodeJS.Platform,
): { binary: string } | { refusal: string };

// `engine-binary.mjs`: the variables the CLI reads a developer's own state
// from.
export const DEVELOPER_STATE_ENV: readonly string[];

// `engine-binary.mjs`: the environment of a developer signed out, whose home
// is `home`; an unset name is undefined.
export function signedOutEnvironment(home: string): Record<string, string | undefined>;
