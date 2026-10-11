import { describe, expect, test } from 'vitest';
import { row } from '../../protocol/__tests__/registry-fixtures';
import { bySystem, categoriesOf, inOrganization, shownRows } from '../filter';

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
