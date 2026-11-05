// A row that has a name and a slug.
export type SluggedRow = { name: string; slug: string };

const slugDiffers = (row: SluggedRow): boolean => row.slug !== row.name;

// What a row of a pick or of the Stacks tree says of a slug beside its name:
// the slug only where it says more than the name does.
const slugBeside = (row: SluggedRow): string[] => (slugDiffers(row) ? [row.slug] : []);

// A row's name, with its slug in parentheses where it says more than the name does.
export const nameWithSlug = (row: SluggedRow): string =>
  slugDiffers(row) ? `${row.name} (${row.slug})` : row.name;

// A row's description: its slug where it says more than its name, then its markers in order,
// on the row's one line.
export const rowDescription = (row: SluggedRow, markers: readonly string[]): string =>
  [...slugBeside(row), ...markers].join(' · ');
