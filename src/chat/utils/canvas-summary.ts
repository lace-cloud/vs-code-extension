import type { CanvasView } from '../../webview/types/render';

type FormatOptions = {
  /** Compact: single-line lists. Detailed (default): markdown headers and bullets. */
  compact?: boolean;
};

/**
 * Format a CanvasView as a text summary.
 *
 * - compact mode: terse one-liner lists (used for chat context injection)
 * - detailed mode: markdown with headers (used for describe_graph tool output)
 */
export function formatCanvasState(view: CanvasView | undefined, opts: FormatOptions = {}): string {
  if (!view) {
    return 'No canvas is open. Tell the user to open one with **Lace: Open Canvas** from the Command Palette before making any canvas changes.';
  }

  if (view.nodes.length === 0) {
    return 'Canvas is open but empty — no modules added yet.';
  }

  if (opts.compact) return formatCompact(view);
  return formatDetailed(view);
}

function formatCompact(view: CanvasView): string {
  const parts: string[] = [
    `Canvas snapshot: ${view.nodes.length} instance(s), ${view.edges.length} connection(s).`,
  ];

  const nodeList = view.nodes
    .map((n) => `${n.id} (${n.label})${n.has_errors ? ' \u26a0' : ''}`)
    .join(', ');
  parts.push(`Instances: ${nodeList}`);

  if (view.edges.length > 0) {
    const edgeList = view.edges
      .map((e) => `${e.source}.${e.source_output}\u2192${e.target}.${e.target_input}`)
      .join(', ');
    parts.push(`Connections: ${edgeList}`);
  }

  if (view.errors.length > 0) {
    parts.push(`Errors: ${view.errors.length} validation error(s) present.`);
  }

  return parts.join('\n');
}

function formatDetailed(view: CanvasView): string {
  const lines: string[] = [];

  lines.push(`**Canvas: ${view.nodes.length} instance(s), ${view.edges.length} connection(s)**`);
  lines.push('');
  lines.push('### Instances');
  for (const node of view.nodes) {
    const errFlag = node.has_errors ? ' \u26a0 has errors' : '';
    lines.push(`- **${node.id}** (${node.label})${errFlag}`);
  }

  if (view.edges.length > 0) {
    lines.push('');
    lines.push('### Connections');
    for (const edge of view.edges) {
      lines.push(
        `- ${edge.source}.${edge.source_output} \u2192 ${edge.target}.${edge.target_input}`,
      );
    }
  }

  if (view.errors.length > 0) {
    lines.push('');
    lines.push('### Errors');
    for (const err of view.errors) {
      const loc = [err.instance_id, err.input_name].filter(Boolean).join('.');
      lines.push(`- ${loc ? `[${loc}] ` : ''}${err.message}`);
    }
  }

  return lines.join('\n');
}
