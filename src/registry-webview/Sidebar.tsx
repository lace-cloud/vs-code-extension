// The registry sidebar: search with category chips (CategoryChips),
// favourites, recently used, the organization's modules and the public ones,
// each by system, every row (ModuleRow) with its versions on expand, its "+"
// and its star. The organization shown is the CLI's selection; its picker
// runs the extension's Select Organization. Every control is a button of its
// own, none inside another, so each is reached by Tab, activated by Enter
// and Space, and announced as a control.
import { type ReactNode, useEffect, useState } from 'react';
import type { RegistryRow, SendSidebarMessage, SidebarState } from '../protocol/registry-protocol';
import { moduleKey } from '../protocol/registry-protocol';
import { CategoryChips } from './CategoryChips';
import { bySystem, categoryFilter, inOrganization, shownRows } from './filter';
import { ModuleRow } from './ModuleRow';

type Loaded = Extract<SidebarState, { kind: 'loaded' }>;

const SEARCH_DEBOUNCE_MS = 150;

export function Sidebar({ state, send }: { state: SidebarState; send: SendSidebarMessage }) {
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [filtersShown, setFiltersShown] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const searching = query.trim() !== '';
  // The chips, what they apply and the filter toggle, from one pure rule
  // (filter.ts): closing the chips keeps the choice, and the toggle stays
  // pressed, named for what applies, while it does.
  const filter = categoryFilter({
    rows: state.kind === 'loaded' ? state.rows : undefined,
    chosen,
    open: filtersShown,
    searching,
  });
  const toggle = (category: string) =>
    setChosen(
      filter.chosen.includes(category)
        ? filter.chosen.filter((c) => c !== category)
        : [...filter.chosen, category],
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
            className={`filter-toggle${filter.toggle.pressed ? ' active' : ''}`}
            title={filter.toggle.name}
            aria-expanded={filter.toggle.expanded}
            disabled={filter.toggle.disabled}
            onClick={() => setFiltersShown((open) => !open)}
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
      {filter.chipsShown && (
        <CategoryChips categories={filter.categories} chosen={filter.chosen} onToggle={toggle} />
      )}
      <div id="content">
        <Content state={state} send={send} query={query} chosen={filter.applied} />
      </div>
    </>
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
  send: SendSidebarMessage;
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
  send: SendSidebarMessage;
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
