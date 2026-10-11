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
