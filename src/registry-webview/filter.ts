// What the sidebar shows of the rows it holds: the one read is unfiltered,
// and search and the category chips narrow it here, as the developer types.
import { moduleLabel, type RegistryRow } from '../protocol/registry-protocol';

// A row of the selected organization's own registry, beside the public one.
export const inOrganization = (row: RegistryRow): boolean => row.visibility !== 'public';

// Search reads the name, the display name, the system, the categories and
// the description.
export function matchesQuery(row: RegistryRow, query: string): boolean {
  const q = query.toLowerCase().trim();
  return [row.name, row.displayName, row.system, row.description, ...row.categories].some((text) =>
    text.toLowerCase().includes(q),
  );
}

// Every category a row carries, once, sorted: the chips.
export function categoriesOf(rows: readonly RegistryRow[]): string[] {
  return [...new Set(rows.flatMap((row) => row.categories))].sort();
}

// The category filter as the sidebar draws it, from the rows listed
// (undefined while the registry is not listed: loading, signed out, no
// organization, failed), the categories chosen, whether the developer has
// the chip row open and whether a search is active. As in VS Code's own
// filtered views, closing the chip row keeps the choice, and the toggle
// looks pressed while the choice applies; a search hides the chips and
// suspends the choice while it is active. The choice is always kept to the
// categories the rows carry, so a category a refresh took away applies
// nothing and no chip shows it chosen.
export type CategoryFilter = {
  // The chips: every category the rows carry.
  categories: string[];
  // The choice, kept to the categories the rows carry.
  chosen: string[];
  // What narrows the list: the choice, unless a search is active.
  applied: string[];
  // Whether the chip row is drawn: open, with categories, and no search.
  chipsShown: boolean;
  // The filter toggle: pressed while a choice applies, expanded while the
  // chips are drawn, disabled with nothing to filter, and named (by its
  // title) for the categories that apply or for why it is disabled.
  toggle: { pressed: boolean; expanded: boolean; disabled: boolean; name: string };
};

export function categoryFilter({
  rows,
  chosen,
  open,
  searching,
}: {
  rows: readonly RegistryRow[] | undefined;
  chosen: readonly string[];
  open: boolean;
  searching: boolean;
}): CategoryFilter {
  const categories = categoriesOf(rows ?? []);
  const kept = chosen.filter((category) => categories.includes(category));
  const applied = searching ? [] : kept;
  const disabled = rows === undefined || categories.length === 0 || searching;
  const chipsShown = open && !disabled;
  const name =
    rows === undefined
      ? 'Filter by category'
      : categories.length === 0
        ? 'No categories to filter'
        : searching
          ? 'Clear the search to filter by category'
          : applied.length > 0
            ? `Filter by category (${applied.join(', ')})`
            : 'Filter by category';
  return {
    categories,
    chosen: kept,
    applied,
    chipsShown,
    toggle: { pressed: applied.length > 0, expanded: chipsShown, disabled, name },
  };
}

// The rows a search shows; with no search, the rows in any chosen
// category, or every row when none is chosen.
export function shownRows(
  rows: readonly RegistryRow[],
  query: string,
  categories: readonly string[],
): RegistryRow[] {
  if (query.trim() !== '') return rows.filter((row) => matchesQuery(row, query));
  if (categories.length === 0) return [...rows];
  return rows.filter((row) => row.categories.some((category) => categories.includes(category)));
}

// Rows by their system, systems sorted, rows by label within each.
export function bySystem(rows: readonly RegistryRow[]): [string, RegistryRow[]][] {
  const groups = new Map<string, RegistryRow[]>();
  for (const row of rows) {
    const system = row.system || 'other';
    groups.set(system, [...(groups.get(system) ?? []), row]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([system, group]) => [
      system,
      group.sort((a, b) => moduleLabel(a).localeCompare(moduleLabel(b))),
    ]);
}
