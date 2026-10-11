// The Output channel of a stack's runs: every log line of an apply, the
// Preview Advisory included, and every line Follow logs reads, so a run's
// output stays readable after its notification is gone. An apply names its
// run only when it ends, so its lines and the lines of every run of the
// stack share the stack's channel, each run under a heading.
import type { CommandRun } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';

export type RunOutput = {
  append: (line: string, run: CommandRun) => void;
  // The channel of the stack `slug`, shown.
  show: (slug: string) => void;
  dispose: () => void;
};

const heading = (run: CommandRun): string =>
  `── lace ${run.path}${run.target.runId === undefined ? '' : ` ${run.target.runId}`} ──`;

export function createRunOutput(
  window: Pick<typeof vscode.window, 'createOutputChannel'>,
): RunOutput {
  const channels = new Map<string, vscode.OutputChannel>();
  const headed = new WeakSet<object>();
  const channel = (slug: string): vscode.OutputChannel => {
    const existing = channels.get(slug);
    if (existing) return existing;
    const made = window.createOutputChannel(`Lace: ${slug}`);
    channels.set(slug, made);
    return made;
  };
  return {
    append(line, run) {
      const out = channel(run.ctx.stack?.slug ?? run.path);
      if (!headed.has(run.token)) {
        headed.add(run.token);
        out.appendLine(heading(run));
      }
      out.appendLine(line);
    },
    show: (slug) => channel(slug).show(true),
    dispose() {
      for (const out of channels.values()) out.dispose();
      channels.clear();
    },
  };
}
