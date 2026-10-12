// The registry sidebar: search with category chips, favourites, recently
// used, the organization's modules and the public ones, each by system,
// every row with its versions on expand, its "+" and its star. The
// organization shown is the CLI's selection; its picker runs the
// extension's Select Organization. Every control is a button of its own,
// none inside another, so each is reached by Tab, activated by Enter and
// Space, and announced as a control.
import { type ReactNode, useEffect, useId, useState } from 'react';
import type {
  Read,
  RegistryRow,
  RegistryVersion,
  SidebarMessage,
  SidebarState,
} from '../protocol/registry-protocol';
import { moduleKey, moduleLabel } from '../protocol/registry-protocol';
import { bySystem, categoriesOf, inOrganization, shownRows } from './filter';
import { ModuleIcon } from './ModuleIcon';

type Send = (message: SidebarMessage) => void;
type Loaded = Extract<SidebarState, { kind: 'loaded' }>;

const SEARCH_DEBOUNCE_MS = 150;

export function Sidebar({ state, send }: { state: SidebarState; send: Send }) {
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [filtersShown, setFiltersShown] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const rows = state.kind === 'loaded' ? state.rows : [];
  const searching = query.trim() !== '';
  const chips = filtersShown && !searching && rows.length > 0 ? categoriesOf(rows) : [];
  const toggle = (category: string) =>
    setChosen((now) =>
      now.includes(category) ? now.filter((c) => c !== category) : [...now, category],
    );

  return (
    <>
      <div className="search-container">
        <div className="search-row">
          <input
            className="search-input"
            type="text"
            placeholder="Search Lace Registry"
            autoFocus
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          <button
            type="button"
            className={`filter-toggle${filtersShown || chosen.length > 0 ? ' active' : ''}`}
            title="Filter by category"
            aria-label="Filter by category"
            aria-expanded={filtersShown}
            onClick={() => setFiltersShown((shown) => !shown)}
          >
            <span aria-hidden="true">{'▽'}</span>
          </button>
        </div>
        {state.kind === 'loaded' && (
          <button
            type="button"
            className="org-picker"
            title="Select Organization"
            onClick={() => send({ op: 'selectOrganization' })}
          >
            {state.organization ?? 'Public Registry'}
          </button>
        )}
      </div>
      {chips.length > 0 && <CategoryChips categories={chips} chosen={chosen} onToggle={toggle} />}
      <div id="content">
        <Content state={state} send={send} query={query} chosen={searching ? [] : chosen} />
      </div>
    </>
  );
}

// The categories to filter by, each a toggle that says whether it is chosen.
export function CategoryChips({
  categories,
  chosen,
  onToggle,
}: {
  categories: readonly string[];
  chosen: readonly string[];
  onToggle: (category: string) => void;
}) {
  return (
    <div id="chips">
      {categories.map((category) => (
        <button
          type="button"
          key={category}
          className={`chip${chosen.includes(category) ? ' active' : ''}`}
          aria-pressed={chosen.includes(category)}
          onClick={() => onToggle(category)}
        >
          {category}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ text, action, run }: { text: string; action?: string; run?: () => void }) {
  return (
    <div className="empty-state">
      {text}
      {action && run && (
        <>
          <br />
          <button type="button" className="retry-btn" onClick={run}>
            {action}
          </button>
        </>
      )}
    </div>
  );
}

function Content({
  state,
  send,
  query,
  chosen,
}: {
  state: SidebarState;
  send: Send;
  query: string;
  chosen: readonly string[];
}) {
  switch (state.kind) {
    case 'loading':
      return <Skeleton />;
    case 'signedOut':
      return (
        <EmptyState
          text="Sign in to browse the Lace registry."
          action="Sign In"
          run={() => send({ op: 'signIn' })}
        />
      );
    case 'noOrganization':
      return (
        <EmptyState
          text="Select an organization to browse its registry."
          action="Select Organization"
          run={() => send({ op: 'selectOrganization' })}
        />
      );
    case 'failed':
      return <EmptyState text={state.message} action="Retry" run={() => send({ op: 'refresh' })} />;
    case 'loaded':
      return <Modules state={state} send={send} query={query} chosen={chosen} />;
  }
}

const flip = (set: ReadonlySet<string>, item: string): Set<string> => {
  const next = new Set(set);
  if (!next.delete(item)) next.add(item);
  return next;
};

function Modules({
  state,
  send,
  query,
  chosen,
}: {
  state: Loaded;
  send: Send;
  query: string;
  chosen: readonly string[];
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  if (state.rows.length === 0) {
    return (
      <EmptyState
        text="No modules are published yet."
        action="How to publish a module"
        run={() => send({ op: 'openPublishingGuide' })}
      />
    );
  }
  const shown = shownRows(state.rows, query, chosen);
  const searching = query.trim() !== '';
  if (shown.length === 0) {
    return (
      <EmptyState
        text={
          searching ? `No modules match "${query.trim()}"` : 'No modules match selected categories'
        }
      />
    );
  }

  const collapse = (section: string) => setCollapsed((now) => flip(now, section));
  const expand = (key: string) => {
    if (!expanded.has(key) && state.versions[key] === undefined) send({ op: 'versions', key });
    setExpanded((now) => flip(now, key));
  };
  const byKey = new Map(state.rows.map((row) => [moduleKey(row), row]));
  const known = (keys: readonly string[]) =>
    keys.flatMap((key) => {
      const row = byKey.get(key);
      return row ? [row] : [];
    });
  const row = (module: RegistryRow, withVersions: boolean) => (
    <ModuleRow
      key={moduleKey(module)}
      row={module}
      starred={state.favourites.includes(moduleKey(module))}
      versions={withVersions ? state.versions[moduleKey(module)] : undefined}
      expanded={withVersions && expanded.has(moduleKey(module))}
      onExpand={withVersions ? () => expand(moduleKey(module)) : undefined}
      send={send}
    />
  );
  const filtering = searching || chosen.length > 0;
  const favourites = filtering ? [] : known(state.favourites);
  const recents = filtering ? [] : known(state.recents);
  const own = shown.filter(inOrganization);
  const open = shown.filter((module) => !inOrganization(module));
  const bySystemSections = (prefix: string, group: readonly RegistryRow[]) =>
    bySystem(group).map(([system, rows]) => (
      <Section
        key={system}
        id={`${prefix}${system}`}
        title={system.toUpperCase()}
        count={rows.length}
        collapsed={collapsed}
        onToggle={collapse}
        nested
      >
        {rows.map((module) => row(module, true))}
      </Section>
    ));

  return (
    <>
      {favourites.length > 0 && (
        <div className="module-list">
          <div className="list-heading">
            <span aria-hidden="true">{'★'}</span> FAVORITES
          </div>
          {favourites.map((module) => row(module, false))}
        </div>
      )}
      {recents.length > 0 && (
        <Section
          id="__recent__"
          icon={'\u{1F552}'}
          title="RECENTLY USED"
          count={recents.length}
          collapsed={collapsed}
          onToggle={collapse}
        >
          {recents.map((module) => row(module, false))}
        </Section>
      )}
      {searching && (
        <div className="result-count">
          {shown.length} module{shown.length === 1 ? '' : 's'}
        </div>
      )}
      {own.length > 0 && (
        <Section
          id="__org__"
          title={(state.organization ?? 'organization').toUpperCase()}
          count={own.length}
          collapsed={collapsed}
          onToggle={collapse}
        >
          {bySystemSections('__org__', own)}
        </Section>
      )}
      {open.length > 0 && (
        <Section
          id="__public__"
          title="PUBLIC"
          count={open.length}
          collapsed={collapsed}
          onToggle={collapse}
        >
          {bySystemSections('__public__', open)}
        </Section>
      )}
      {state.truncated && (
        <div className="result-count">
          Showing the first {state.rows.length} modules. Search narrows them.
        </div>
      )}
    </>
  );
}

function Section({
  id,
  icon,
  title,
  count,
  collapsed,
  onToggle,
  nested,
  children,
}: {
  id: string;
  // A glyph before the title, which a screen reader skips.
  icon?: string;
  title: string;
  count: number;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  nested?: boolean;
  children: ReactNode;
}) {
  const closed = collapsed.has(id) ? ' collapsed' : '';
  const header = (
    <button
      type="button"
      className={`system-header${closed}`}
      aria-expanded={!collapsed.has(id)}
      onClick={() => onToggle(id)}
    >
      <span className="chevron" aria-hidden="true">
        {'▾'}
      </span>{' '}
      {icon && (
        <>
          <span aria-hidden="true">{icon}</span>{' '}
        </>
      )}
      {title} <span className="module-count">({count})</span>
    </button>
  );
  const body = <div className={`system-body${closed}`}>{children}</div>;
  if (nested) {
    return (
      <>
        {header}
        {body}
      </>
    );
  }
  return (
    <div className="module-list">
      {header}
      {body}
    </div>
  );
}

// One module's row: the module itself, a button named by its name and
// version and described by its categories, which opens its detail and whose
// hit area is the whole row; then its actions, side by side.
export function ModuleRow({
  row,
  starred,
  versions,
  expanded,
  onExpand,
  send,
}: {
  row: RegistryRow;
  starred: boolean;
  versions: Read<readonly RegistryVersion[]> | undefined;
  expanded: boolean;
  onExpand: (() => void) | undefined;
  send: Send;
}) {
  const key = moduleKey(row);
  const label = moduleLabel(row);
  const id = useId();
  return (
    <>
      <div className="module-item">
        <button
          type="button"
          className="module-open"
          aria-labelledby={`${id}-name`}
          aria-describedby={row.categories.length > 0 ? `${id}-categories` : undefined}
          onClick={() => send({ op: 'showDetail', key })}
        >
          <ModuleIcon vendor={row.vendor} className="module-icon" />
          <span className="module-info">
            <span className="module-name" id={`${id}-name`}>
              {label} <span className="module-version">{row.version}</span>
            </span>
            {row.categories.length > 0 && (
              <span className="module-categories" id={`${id}-categories`}>
                {row.categories.join(', ')}
              </span>
            )}
          </span>
        </button>
        <div className="module-actions">
          {onExpand && (
            <button
              type="button"
              className={`version-toggle${expanded ? ' expanded' : ''}`}
              title={expanded ? 'Hide other versions' : 'Show all versions'}
              aria-label={`Versions of ${label}`}
              aria-expanded={expanded}
              onClick={onExpand}
            >
              {expanded ? '▾' : '▸'}
            </button>
          )}
          <button
            type="button"
            className="module-add"
            title="Add to canvas"
            aria-label={`Add ${label} ${row.version} to the canvas`}
            onClick={() => send({ op: 'place', key, version: row.version })}
          >
            +
          </button>
          <button
            type="button"
            className={`module-star${starred ? ' starred' : ''}`}
            title="Favorite"
            aria-label={`Favorite ${label}`}
            aria-pressed={starred}
            onClick={() => send({ op: 'toggleFavourite', key })}
          >
            {starred ? '★' : '☆'}
          </button>
        </div>
      </div>
      {expanded && <OlderVersions row={row} versions={versions} send={send} />}
    </>
  );
}

function OlderVersions({
  row,
  versions,
  send,
}: {
  row: RegistryRow;
  versions: Read<readonly RegistryVersion[]> | undefined;
  send: Send;
}) {
  const note = (text: string) => (
    <div className="version-row">
      <span className="version-row-label">{text}</span>
    </div>
  );
  const older =
    versions?.kind === 'loaded' ? versions.value.filter((v) => v.version !== row.version) : [];
  return (
    <div className="version-children">
      {(versions === undefined || versions.kind === 'loading') && note('Loading versions…')}
      {versions?.kind === 'failed' && note(versions.message)}
      {versions?.kind === 'loaded' && older.length === 0 && note('No other versions')}
      {older.map((v) => (
        <div className="version-row" key={v.version}>
          <span className="version-row-label">{v.version}</span>
          <button
            type="button"
            className="version-row-add"
            title={`Add ${v.version} to canvas`}
            aria-label={`Add ${moduleLabel(row)} ${v.version} to the canvas`}
            onClick={() => send({ op: 'place', key: moduleKey(row), version: v.version })}
          >
            +
          </button>
        </div>
      ))}
    </div>
  );
}

function Skeleton() {
  return (
    <>
      {[0, 1, 2].map((group) => (
        <div className="skeleton-group" key={group}>
          <div className="skeleton-header" />
          {[0, 1, 2, 3].map((item) => (
            <div className="skeleton-item" key={item}>
              <div className="skeleton-icon" />
              <div className="skeleton-lines">
                <div className="skeleton-line" />
                <div className="skeleton-line" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
