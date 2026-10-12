import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { described, LOGO, record, row, vendor } from '../../protocol/__tests__/registry-fixtures';
import type { DetailState, SidebarState } from '../../protocol/registry-protocol';
import { Interface, ModuleDetail, usageExample, Versions } from '../ModuleDetail';
import { FALLBACK_GLYPH } from '../ModuleIcon';
import { CategoryChips, ModuleRow, Sidebar } from '../Sidebar';

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

// The deepest a <button> sits inside another in `html`: 1 when none holds
// another.
const buttonDepth = (html: string): number => {
  let depth = 0;
  let deepest = 0;
  for (const [tag] of html.matchAll(/<\/?button\b/g)) {
    depth += tag === '<button' ? 1 : -1;
    deepest = Math.max(deepest, depth);
  }
  return deepest;
};

// The first class of each button in `html`, in order.
const buttonClasses = (html: string): string[] =>
  [...html.matchAll(/<button type="button" class="([^" ]+)/g)].map(([, name]) => name);

describe('the registry sidebar page', () => {
  test('makes every control a button of its own, so each is announced and reached as one', () => {
    const html = sidebar(loaded({ rows: [VPC, DB], favourites: ['acme/db'] }));
    expect(html).not.toContain('role="button"');
    expect(buttonDepth(html)).toBe(1);
  });

  test('a row opens its detail from a button of its own, with its versions toggle, "+" and star beside it', () => {
    const html = sidebar(loaded({ rows: [VPC] }));
    expect(
      buttonClasses(html).filter((name) => name.startsWith('module-') || name === 'version-toggle'),
    ).toEqual(['module-open', 'version-toggle', 'module-add', 'module-star']);
    expect(html).toContain('aria-label="Add ACME VPC v2.0.0 to the canvas"');
  });

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

// The text an element of `html` holds, found by its id, with its tags
// dropped.
const textOf = (html: string, id: string | undefined): string | undefined => {
  if (id === undefined) return undefined;
  const at = html.indexOf(`id="${id}"`);
  if (at < 0) return undefined;
  const open = html.lastIndexOf('<', at);
  const tag = html.slice(open + 1).match(/^\w+/)?.[0];
  let depth = 0;
  for (const match of html.slice(open).matchAll(new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g'))) {
    depth += match[1] === '/' ? -1 : 1;
    if (depth === 0) {
      return html
        .slice(open, open + (match.index ?? 0))
        .replace(/<[^>]*>/g, '')
        .trim();
    }
  }
  return undefined;
};

// The attributes of the first tag in `html` whose class list starts with
// `name`.
const attributesOf = (html: string, name: string): Record<string, string> => {
  const tag = html.match(new RegExp(`<\\w+[^>]*class="${name}[" ][^>]*>`))?.[0] ?? '';
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
  );
};

const moduleRow = (props: Partial<Parameters<typeof ModuleRow>[0]> = {}) =>
  renderToStaticMarkup(
    <ModuleRow
      row={DB}
      starred={false}
      versions={undefined}
      expanded={false}
      onExpand={nothing}
      send={nothing}
      {...props}
    />,
  );

describe('what the registry sidebar says to a screen reader', () => {
  test("a module button is named by the module's name and version, and described by its categories", () => {
    const html = moduleRow();
    const open = attributesOf(html, 'module-open');
    expect(textOf(html, open['aria-labelledby'])).toBe('ACME DB v2.0.0');
    expect(textOf(html, open['aria-describedby'])).toBe('data');
  });

  test('the star keeps one name and title, and says whether it is pressed', () => {
    for (const starred of [false, true]) {
      expect(attributesOf(moduleRow({ starred }), 'module-star')).toMatchObject({
        'aria-label': 'Favorite ACME DB',
        title: 'Favorite',
        'aria-pressed': String(starred),
      });
    }
  });

  test('the versions toggle says whether it is expanded, and its title follows', () => {
    const shut = attributesOf(moduleRow(), 'version-toggle');
    const open = attributesOf(moduleRow({ expanded: true }), 'version-toggle');
    expect(shut).toMatchObject({ 'aria-expanded': 'false', title: 'Show all versions' });
    expect(open).toMatchObject({ 'aria-expanded': 'true', title: 'Hide other versions' });
    expect(open.class).toBe('version-toggle expanded');
  });

  test('the filter toggle is named and says whether the categories are shown; its glyph is hidden', () => {
    const html = sidebar(loaded({ rows: [VPC] }));
    expect(attributesOf(html, 'filter-toggle')).toMatchObject({
      'aria-label': 'Filter by category',
      'aria-expanded': 'false',
    });
    expect(html).toMatch(/class="filter-toggle[^>]*><span aria-hidden="true">▽<\/span><\/button>/);
  });

  test('a category chip says whether it is chosen', () => {
    const html = renderToStaticMarkup(
      <CategoryChips categories={['data', 'networking']} chosen={['data']} onToggle={nothing} />,
    );
    expect(html).toContain('aria-pressed="true">data</button>');
    expect(html).toContain('aria-pressed="false">networking</button>');
  });

  test("headings' glyphs are hidden, and the favourites heading is no control", () => {
    const html = sidebar(
      loaded({ rows: [VPC, DB], favourites: ['acme/vpc'], recents: ['acme/db'] }),
    );
    expect(html).toContain('<span class="chevron" aria-hidden="true">▾</span>');
    expect(html).toContain('<span aria-hidden="true">\u{1F552}</span>');
    expect(html).toContain(
      '<div class="list-heading"><span aria-hidden="true">★</span> FAVORITES</div>',
    );
    expect(html).not.toContain('class="system-header"><');
    expect(html).not.toMatch(/<div class="system-header/);
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
