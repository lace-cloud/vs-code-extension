// Import Existing Resources: the package's `import` binding (`lace stack
// import`, which converts the root's Terraform as Convert does and adds an
// import block for each resource a statefile records) run through the
// window's runner over the root and a stack of it. It is a stack command,
// so the host draws it: the canvas's source-refused banner offers it beside
// Convert on the panel's root, and Lace: Import Existing Resources on the
// root `rootToAct` names.
//
// The stack is the one stack pick's (`pickStack`), which stops at a root
// with no stack. The root's Terraform files with unsaved changes in an
// editor are saved first, as Convert saves them: the import writes over
// what the developer sees. The import runs under a progress notification
// until its run ends; the runner's form asks for the statefile, and the
// package's notice says what the import did. A failure is shown with its
// ways out, and an import that stopped at resources it cannot adopt
// (`import_residual`) offers the package's Import the rest, which reads the
// statefile this run was given.
import type * as vscode from 'vscode';
import { saveTerraformBuffers } from '../commands/terraform-buffers';
import { binding, type RunnerHost } from '../engine/runner-host';
import {
  type AuthoringRoot,
  type RootSources,
  rootLabel,
  rootPath,
  rootToAct,
} from '../roots/authoring-roots';
import type { PickStack } from './stack-pick';

export const IMPORT_RESOURCES = 'lace.importResources';

export type ImportResourcesOptions = {
  api: {
    window: Pick<typeof vscode.window, 'withProgress' | 'showErrorMessage'>;
    workspace: Pick<typeof vscode.workspace, 'textDocuments'>;
    ProgressLocation: Pick<typeof vscode.ProgressLocation, 'Notification'>;
  };
  sources: Pick<RootSources, 'folders'>;
  runner: Pick<RunnerHost, 'run'>;
  pickStack: PickStack;
};

// Imports existing resources into a stack of `root`.
export function importResources(
  options: ImportResourcesOptions,
): (root: AuthoringRoot) => Promise<void> {
  const { api, sources, runner, pickStack } = options;
  const IMPORT = binding('import');
  return async (root) => {
    const stack = await pickStack(root, 'import into');
    if (!stack) return;
    if (!(await saveTerraformBuffers(api.workspace, root))) {
      void api.window.showErrorMessage(
        `A Terraform file in ${rootLabel(root, sources.folders())} did not save, so Lace did not import into ${stack.slug}.`,
      );
      return;
    }
    await api.window.withProgress(
      { location: api.ProgressLocation.Notification, title: `Importing into ${stack.slug}` },
      async () => {
        const { ended } = await runner.run(IMPORT, { root: rootPath(root), stack });
        await ended;
      },
    );
  };
}

// Lace: Import Existing Resources, on the root `rootToAct` names from what
// the command is pointed at.
export function importResourcesCommand(
  window: Pick<typeof vscode.window, 'showInformationMessage'>,
  sources: RootSources,
  importInto: (root: AuthoringRoot) => Promise<void>,
): (pointedAt?: vscode.Uri) => Promise<void> {
  return async (pointedAt) => {
    const root = await rootToAct(sources, window, 'import existing resources into', pointedAt);
    if (root) await importInto(root);
  };
}
