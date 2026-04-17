// Filesystem access the workspace-context tool needs.
//
// Only one tool in the registry reaches into the filesystem today
// (`lace_workspace_context`, which scans project files to build a
// ProjectProfile). Every other tool is a pure RPC passthrough via
// `@lace/host`, so keeping filesystem access as its own adapter
// isolates the single concern that would otherwise force vscode or
// JetBrains APIs into the tool layer.

export interface FileSystemAdapter {
  /** Absolute path of the current workspace root, or `null` outside a workspace. */
  getWorkspaceRoot(): string | null;

  /**
   * Read a UTF-8 file from disk. Implementations truncate to
   * `maxBytes` if provided to avoid pulling in huge files
   * (lockfiles, build artefacts) that the LLM has no use for.
   */
  readFile(absolutePath: string, maxBytes?: number): Promise<string>;

  /** List top-level entry names in a directory (files + subdirectories). */
  listDirectory(absolutePath: string): Promise<string[]>;
}
