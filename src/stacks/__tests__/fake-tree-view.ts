// VS Code's tree view as the extension host holds it (its ExtHostTreeView):
// each element VS Code draws, by the handle its TreeItem's `id` gives it
// (its label under its parent's, without one), and the command a menu runs,
// which is handed the element its handle names when the command is chosen,
// or undefined when the view holds none by then. A redraw of elements drops
// every element under each at once, draws it again and, while it is
// expanded, asks its children again, holding them once the provider answers;
// a redraw of the whole tree drops every element and asks again from the
// root, and again under each element that was expanded. What it was handed
// while an ask is pending is what VS Code still draws.
import type * as vscode from 'vscode';

const ROOT = '';

export function fakeTreeView<T>(provider: vscode.TreeDataProvider<T>) {
  const elements = new Map<string, T>();
  const handles = new Map<T, string>();
  const children = new Map<string, string[]>();
  const expanded = new Set<string>();
  const asks = new Set<Promise<void>>();

  function drop(handle: string): void {
    for (const child of children.get(handle) ?? []) {
      drop(child);
      const element = elements.get(child);
      elements.delete(child);
      if (element !== undefined) handles.delete(element);
    }
    children.delete(handle);
  }

  async function ask(parent: T | undefined, handle: string): Promise<void> {
    const answered = (await provider.getChildren(parent)) ?? [];
    const held: string[] = [];
    for (const child of answered) {
      const item = await provider.getTreeItem(child);
      const label = typeof item.label === 'string' ? item.label : item.label?.label;
      const own = item.id ?? `${handle}/${label}`;
      elements.set(own, child);
      handles.set(child, own);
      held.push(own);
    }
    children.set(handle, held);
    await Promise.all(
      held.filter((own) => expanded.has(own)).map((own) => asking(elements.get(own), own)),
    );
  }

  function asking(parent: T | undefined, handle: string): Promise<void> {
    const pending = ask(parent, handle).finally(() => asks.delete(pending));
    asks.add(pending);
    return pending;
  }

  provider.onDidChangeTreeData?.((changed) => {
    if (changed === undefined || changed === null) {
      drop(ROOT);
      void asking(undefined, ROOT);
      return;
    }
    // One element when it is no array: TypeScript cannot tell a T that is an
    // array itself from the event's list of them.
    const redrawn: readonly T[] = Array.isArray(changed) ? changed : [changed as T];
    for (const element of redrawn) {
      const handle = handles.get(element);
      if (handle === undefined) continue;
      drop(handle);
      void provider.getTreeItem(element);
      if (expanded.has(handle)) void asking(element, handle);
    }
  });

  return {
    // The view comes on screen: its root's children are asked.
    show: () => asking(undefined, ROOT),
    // The element `handle` names is expanded: its children are asked.
    expand(handle: string): Promise<void> {
      expanded.add(handle);
      return asking(elements.get(handle), handle);
    },
    // What a menu opened on the element `handle` names hands its command,
    // chosen now.
    argument: (handle: string): T | undefined => elements.get(handle),
    // The handles of the elements drawn under `handle`.
    drawn: (handle: string = ROOT): readonly string[] => children.get(handle) ?? [],
    // Resolves once every ask pending now and since has been answered.
    async answered(): Promise<void> {
      while (asks.size > 0) await Promise.all([...asks]);
    },
  };
}
