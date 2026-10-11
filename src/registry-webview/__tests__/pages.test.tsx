import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { described, LOGO, record, row, vendor } from '../../protocol/__tests__/registry-fixtures';
import type { DetailState, SidebarState } from '../../protocol/registry-protocol';
import { Interface, ModuleDetail, usageExample, Versions } from '../ModuleDetail';
import { FALLBACK_GLYPH } from '../ModuleIcon';
import { Sidebar } from '../Sidebar';

const nothing = () => {};

const loaded = (over: Partial<Extract<SidebarState, { kind: 'loaded' }>> = {}): SidebarState => ({
  kind: 'loaded',
  rows: [],
  truncated: false,
  organization: null,
  favourites: [],
  recents: [],
  versions: {},
  ...over,
});

const sidebar = (state: SidebarState) =>
  renderToStaticMarkup(<Sidebar state={state} send={nothing} />);

const VPC = row({ vendor: vendor(LOGO) });
const DB = row({ name: 'db', displayName: 'ACME DB', system: 'gcp', categories: ['data'] });
const PRIVATE = row({ name: 'net', displayName: 'Org Net', visibility: 'org_private' });

describe('the registry sidebar page', () => {
  test('draws each row: label, version, categories, under its system and its registry', () => {
    const html = sidebar(loaded({ rows: [VPC, DB, PRIVATE], organization: 'acme-org' }));
    for (const text of ['ACME VPC', 'v2.0.0', 'networking', 'ACME DB', 'data', 'Org Net']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('PUBLIC');
    expect(html).toContain('ACME-ORG');
    expect(html).toContain('AWS');
    expect(html).toContain('GCP');
    expect(html.indexOf('ACME-ORG')).toBeLessThan(html.indexOf('PUBLIC'));
  });

  test('shows a version as the registry spells it', () => {
    const html = sidebar(loaded({ rows: [VPC] }));
    expect(html).toContain('<span class="module-version">v2.0.0</span>');
    expect(html).not.toContain('vv2.0.0');
  });

  test("shows the vendor's logo, and the glyph for a vendor with none", () => {
    const html = sidebar(loaded({ rows: [VPC, DB] }));
    expect(html).toContain(`<img src="${LOGO}"`);
    expect(html).toContain(FALLBACK_GLYPH);
  });

  test('a registry with no module shows the publishing guide’s link', () => {
    const html = sidebar(loaded());
    expect(html).toContain('No modules are published yet.');
    expect(html).toContain('How to publish a module');
  });

  test.each([
    [{ kind: 'signedOut' } as SidebarState, 'Sign In'],
    [{ kind: 'noOrganization' } as SidebarState, 'Select Organization'],
    [{ kind: 'failed', message: 'the engine stopped' } as SidebarState, 'Retry'],
  ])('%j offers %s', (state, action) => {
    expect(sidebar(state)).toContain(`>${action}</button>`);
  });

  test('a failure shows its message', () => {
    expect(sidebar({ kind: 'failed', message: 'the engine stopped' })).toContain(
      'the engine stopped',
    );
  });

  test('favourites and recently used are drawn by author and name, starred', () => {
    const html = sidebar(
      loaded({ rows: [VPC, DB], favourites: ['acme/vpc', 'gone/module'], recents: ['acme/db'] }),
    );
    expect(html).toContain('FAVORITES');
    expect(html).toContain('RECENTLY USED');
    expect(html).toContain('module-star starred');
  });

  test('the organization picker shows the CLI’s selection, or the public registry', () => {
    expect(sidebar(loaded({ organization: 'acme-org' }))).toContain('>acme-org</button>');
    expect(sidebar(loaded())).toContain('>Public Registry</button>');
  });

  test('a list that filled its limit says so', () => {
    expect(sidebar(loaded({ rows: [VPC], truncated: true }))).toContain('Showing the first 1');
  });
});

const detail = (over: Partial<DetailState> = {}): DetailState => ({
  row: VPC,
  record: { kind: 'loaded', value: record({ readme: '# Usage\n\nPlace it **once**.' }) },
  describe: { kind: 'loaded', value: described },
  ...over,
});

describe('the module detail page', () => {
  test('keeps the four tabs and the header with Add to Canvas', () => {
    const html = renderToStaticMarkup(<ModuleDetail state={detail()} send={nothing} />);
    for (const tab of ['Details', 'Interface', 'Versions', 'Examples']) {
      expect(html).toContain(`>${tab}</button>`);
    }
    expect(html).toContain('Add to Canvas');
    expect(html).toContain(`<img src="${LOGO}"`);
  });

  test('renders the README as markdown in Details', () => {
    const html = renderToStaticMarkup(<ModuleDetail state={detail()} send={nothing} />);
    expect(html).toContain('<h1>Usage</h1>');
    expect(html).toContain('<strong>once</strong>');
  });

  test("a README's raw HTML is not run as markup", () => {
    const readme = 'Hi <script>alert(1)</script><img src=x onerror="alert(2)">';
    const html = renderToStaticMarkup(
      <ModuleDetail
        state={detail({ record: { kind: 'loaded', value: record({ readme }) } })}
        send={nothing}
      />,
    );
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/<img[^>]*onerror/);
    expect(html).toContain('&lt;script&gt;');
  });

  test('without a README, Details shows the description', () => {
    const html = renderToStaticMarkup(
      <ModuleDetail
        state={detail({ record: { kind: 'loaded', value: record() } })}
        send={nothing}
      />,
    );
    expect(html).toContain('A VPC module');
  });

  test("Interface draws the described inputs and outputs; a refusal is the banner's message", () => {
    const html = renderToStaticMarkup(<Interface read={{ kind: 'loaded', value: described }} />);
    for (const text of ['cidr', 'string', 'The VPC range', 'vpc_id']) expect(html).toContain(text);

    const refused = renderToStaticMarkup(
      <ModuleDetail
        state={detail({ describe: { kind: 'failed', message: 'not in Lace form' } })}
        send={nothing}
      />,
    );
    expect(refused).toContain('not in Lace form');
  });

  test('Versions marks the version the row shows', () => {
    const html = renderToStaticMarkup(
      <Versions read={{ kind: 'loaded', value: record() }} current="v2.0.0" />,
    );
    expect(html).toContain('version-tag active">v2.0.0');
    expect(html).toContain('version-tag">v1.0.0');
  });

  test('the usage example names the source and the inputs', () => {
    const example = usageExample(detail(), described);
    expect(example).toContain('# Version: v2.0.0');
    expect(example).toContain('# Source: lace.cloud/acme/vpc/aws');
    expect(example).toContain('#   cidr: string (required)');
  });
});
