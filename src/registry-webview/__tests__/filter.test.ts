import { describe, expect, test } from 'vitest';
import { row } from '../../protocol/__tests__/registry-fixtures';
import { bySystem, categoriesOf, categoryFilter, inOrganization, shownRows } from '../filter';

const VPC = row({ categories: ['networking', 'core'] });
const DB = row({ name: 'db', displayName: 'Postgres', system: 'gcp', categories: ['data'] });
const LOG = row({
  name: 'log',
  displayName: 'Logs',
  description: 'ships audit trails',
  categories: [],
});

describe('what the sidebar shows', () => {
  test('search reads the name, display name, system, categories and description', () => {
    expect(shownRows([VPC, DB, LOG], 'postgres', [])).toEqual([DB]);
    expect(shownRows([VPC, DB, LOG], 'GCP', [])).toEqual([DB]);
    expect(shownRows([VPC, DB, LOG], 'core', [])).toEqual([VPC]);
    expect(shownRows([VPC, DB, LOG], 'audit', [])).toEqual([LOG]);
    expect(shownRows([VPC, DB, LOG], 'log', [])).toEqual([LOG]);
  });

  test('chips are every category once, sorted, and any chosen one shows a row', () => {
    expect(categoriesOf([VPC, DB, LOG])).toEqual(['core', 'data', 'networking']);
    expect(shownRows([VPC, DB, LOG], '', ['data', 'core'])).toEqual([VPC, DB]);
    expect(shownRows([VPC, DB, LOG], '', [])).toEqual([VPC, DB, LOG]);
  });

  test("a row is the organization's when it is not public", () => {
    expect(inOrganization(row({ visibility: 'org_private' }))).toBe(true);
    expect(inOrganization(VPC)).toBe(false);
  });

  test('rows group by system, sorted, rows by label', () => {
    const z = row({ name: 'z', displayName: 'Zone' });
    expect(
      bySystem([z, DB, VPC]).map(([system, rows]) => [system, rows.map((r) => r.name)]),
    ).toEqual([
      ['aws', ['vpc', 'z']],
      ['gcp', ['db']],
    ]);
  });
});

describe('the category filter', () => {
  const rows = [VPC, DB, LOG];
  const idle = { rows, chosen: [] as string[], open: false, searching: false };

  test('choosing a category on the open chip row applies it, presses the toggle and names it', () => {
    expect(categoryFilter({ ...idle, open: true, chosen: ['data'] })).toEqual({
      categories: ['core', 'data', 'networking'],
      chosen: ['data'],
      applied: ['data'],
      chipsShown: true,
      toggle: {
        pressed: true,
        expanded: true,
        disabled: false,
        name: 'Filter by category (data)',
      },
    });
  });

  test('the open chip row with nothing chosen applies nothing and is not pressed', () => {
    expect(categoryFilter({ ...idle, open: true })).toMatchObject({
      applied: [],
      chipsShown: true,
      toggle: { pressed: false, expanded: true, disabled: false, name: 'Filter by category' },
    });
  });

  test('closing the chip row keeps the choice applied, and the toggle pressed and named for it', () => {
    expect(categoryFilter({ ...idle, chosen: ['data', 'core'] })).toMatchObject({
      chosen: ['data', 'core'],
      applied: ['data', 'core'],
      chipsShown: false,
      toggle: {
        pressed: true,
        expanded: false,
        disabled: false,
        name: 'Filter by category (data, core)',
      },
    });
  });

  test('reopening the chip row shows the choice it kept', () => {
    const closed = categoryFilter({ ...idle, chosen: ['data'] });
    expect(categoryFilter({ ...idle, open: true, chosen: closed.chosen })).toMatchObject({
      chosen: ['data'],
      applied: ['data'],
      chipsShown: true,
      toggle: { pressed: true, expanded: true },
    });
  });

  test('a search hides the chips and suspends the choice, which it keeps, and the toggle says why it is off', () => {
    expect(categoryFilter({ ...idle, open: true, chosen: ['data'], searching: true })).toEqual({
      categories: ['core', 'data', 'networking'],
      chosen: ['data'],
      applied: [],
      chipsShown: false,
      toggle: {
        pressed: false,
        expanded: false,
        disabled: true,
        name: 'Clear the search to filter by category',
      },
    });
  });

  test('a chosen category a refresh took away is dropped: it applies nothing and presses nothing', () => {
    expect(
      categoryFilter({ ...idle, rows: [VPC, LOG], open: true, chosen: ['data', 'core'] }),
    ).toMatchObject({
      categories: ['core', 'networking'],
      chosen: ['core'],
      applied: ['core'],
      toggle: { pressed: true, name: 'Filter by category (core)' },
    });
    expect(categoryFilter({ ...idle, rows: [VPC, LOG], chosen: ['data'] })).toMatchObject({
      chosen: [],
      applied: [],
      toggle: { pressed: false, disabled: false, name: 'Filter by category' },
    });
  });

  test.each([
    ['no rows', [], 'No categories to filter'],
    ['rows without categories', [LOG], 'No categories to filter'],
    ['the registry not listed', undefined, 'Filter by category'],
  ])('with %s there is nothing to filter: no chips, nothing applied, the toggle disabled', (_name, listed, name) => {
    expect(categoryFilter({ ...idle, rows: listed, open: true, chosen: ['data'] })).toEqual({
      categories: [],
      chosen: [],
      applied: [],
      chipsShown: false,
      toggle: { pressed: false, expanded: false, disabled: true, name },
    });
  });
});
