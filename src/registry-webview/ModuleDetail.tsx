// Module detail: the header with Add to Canvas, then the tabs Details,
// Interface, Versions and Examples, laid out and operated as the WAI-ARIA
// tabs pattern has them (arrow keys, Home and End move between tabs; only
// the selected tab is in the Tab order). Details renders the module's
// README; Interface is the certified interface `registry describe` reads,
// which loads after the header because describing a version downloads and
// certifies it.
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  DetailState,
  ModuleInterface,
  Read,
  RegistryRecord,
  SendDetailMessage,
} from '../protocol/registry-protocol';
import { moduleLabel } from '../protocol/registry-protocol';
import { ModuleIcon } from './ModuleIcon';

const TABS = [
  ['details', 'Details'],
  ['interface', 'Interface'],
  ['versions', 'Versions'],
  ['examples', 'Examples'],
] as const;

type Tab = (typeof TABS)[number][0];

const KIND = 'Module';

// A box whose content may be wider than the page, which scrolls sideways
// in it, so the page never does: a table, a fenced code block, the usage
// example. It is a named region in the Tab order, so a keyboard can scroll
// it and a screen reader says what it holds.
function ScrollBox({
  label,
  className,
  as: Box = 'div',
  children,
}: {
  label: string;
  className?: string;
  as?: 'div' | 'pre';
  children: ReactNode;
}) {
  return (
    <Box
      className={className ? `scroll-box ${className}` : 'scroll-box'}
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      {children}
    </Box>
  );
}

// The README's tables and fenced code blocks, each in a ScrollBox of its own.
const README_COMPONENTS: Components = {
  table: ({ node: _node, ...props }) => (
    <ScrollBox label="README table" className="table-scroll">
      <table {...props} />
    </ScrollBox>
  ),
  pre: ({ node: _node, children }) => (
    <ScrollBox label="README code block" as="pre">
      {children}
    </ScrollBox>
  ),
};

// What an arrow key, Home or End on the tab bar moves to, from the tab at
// `at`: the next or the previous tab, round the end, or the first or last.
const TAB_KEYS: Record<string, (at: number) => number> = {
  ArrowRight: (at) => (at + 1) % TABS.length,
  ArrowLeft: (at) => (at - 1 + TABS.length) % TABS.length,
  Home: () => 0,
  End: () => TABS.length - 1,
};

const loaded = <T,>(read: Read<T>): T | undefined =>
  read.kind === 'loaded' ? read.value : undefined;

export function ModuleDetail({ state, send }: { state: DetailState; send: SendDetailMessage }) {
  const [tab, setTab] = useState<Tab>('details');
  const tabs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const id = useId();
  const tabId = (each: Tab) => `${id}-tab-${each}`;
  const panelId = `${id}-panel`;
  // Selecting a tab by key moves the focus to it, as a click does.
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const move = TAB_KEYS[event.key];
    if (move === undefined) return;
    event.preventDefault();
    const [next] = TABS[move(TABS.findIndex(([each]) => each === tab))];
    setTab(next);
    tabs.current[next]?.focus();
  };
  const { row } = state;
  const record = loaded(state.record);
  const described = loaded(state.describe);
  const description = record?.latest.description || row.description;
  return (
    <>
      <div className="header">
        <ModuleIcon vendor={record?.latest.vendor ?? row.vendor} className="header-icon" />
        <div className="header-main">
          <div className="header-info">
            <h1>{moduleLabel(row)}</h1>
            <div className="header-meta">
              <span className="badge">{KIND}</span>
              <span>{row.version}</span>
              <span className="meta-next">{row.system.toUpperCase()}</span>
              {row.categories.length > 0 && (
                <span className="meta-next">{row.categories.join(', ')}</span>
              )}
            </div>
            {description && <p className="header-description">{description}</p>}
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => send({ op: 'place', version: row.version })}
            >
              Add to Canvas
            </button>
          </div>
        </div>
      </div>

      {state.describe.kind === 'failed' && (
        <div className="error-banner">
          The module's interface could not be loaded: {state.describe.message}
        </div>
      )}
      {state.record.kind === 'failed' && (
        <div className="error-banner">
          The module's details could not be loaded: {state.record.message}
        </div>
      )}

      <div className="tabs" role="tablist" aria-label={`${moduleLabel(row)} sections`}>
        {TABS.map(([each, label]) => (
          <button
            type="button"
            role="tab"
            id={tabId(each)}
            aria-selected={tab === each}
            aria-controls={panelId}
            tabIndex={tab === each ? 0 : -1}
            key={each}
            ref={(button) => {
              tabs.current[each] = button;
            }}
            className={`tab${tab === each ? ' active' : ''}`}
            onClick={() => setTab(each)}
            onKeyDown={onTabKey}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className="content"
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(tab)}
        tabIndex={0}
      >
        {tab === 'details' && (
          <Details state={state} record={record} described={described} description={description} />
        )}
        {tab === 'interface' && <Interface read={state.describe} />}
        {tab === 'versions' && <Versions read={state.record} current={row.version} />}
        {tab === 'examples' && <Examples state={state} described={described} />}
      </div>
    </>
  );
}

function Loading({ what }: { what: string }) {
  return <div className="loading">Loading {what}...</div>;
}

function Details({
  state,
  record,
  described,
  description,
}: {
  state: DetailState;
  record: RegistryRecord | undefined;
  described: ModuleInterface | undefined;
  description: string;
}) {
  const { row } = state;
  const latest = record?.latest;
  const counted = (n: number | undefined) => (n === undefined ? '—' : `${n} defined`);
  const reference: [string, string][] = [
    ['System', row.system.toUpperCase()],
    ['Kind', KIND],
    ['Latest Version', row.version],
    ['Author', latest?.vendor?.displayName ?? row.author],
    ['Source', row.sourceAddress || '—'],
    ['Inputs', counted(described?.interface.inputs.length)],
    ['Outputs', counted(described?.interface.outputs.length)],
  ];
  if (latest) {
    reference.push(['Installs', String(latest.installCount)]);
    if (latest.publishedAt) reference.push(['Published', latest.publishedAt.slice(0, 10)]);
  }
  return (
    <div className="tab-content active">
      <div className="section">
        <h2>About</h2>
        {state.record.kind === 'loading' && <Loading what="module details" />}
        {latest?.readme ? (
          <div className="readme">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={README_COMPONENTS}>
              {latest.readme}
            </ReactMarkdown>
          </div>
        ) : (
          state.record.kind !== 'loading' && (
            <p>
              {description ||
                'No description available for this module. Check the Lace registry for documentation.'}
            </p>
          )
        )}
      </div>
      <div className="section">
        <h2>Quick Reference</h2>
        <ScrollBox label="Quick Reference" className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="property">Property</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {reference.map(([property, value]) => (
                <tr key={property}>
                  <td>{property}</td>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      </div>
    </div>
  );
}

export function Interface({ read }: { read: Read<ModuleInterface> }) {
  if (read.kind === 'loading') return <Loading what="the module's interface" />;
  const { inputs, outputs } =
    read.kind === 'loaded' ? read.value.interface : { inputs: [], outputs: [] };
  return (
    <div className="tab-content active interface">
      <div className="section">
        <h2>Inputs</h2>
        <ScrollBox label="Inputs" className="table-scroll">
          <table className="interface-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Required</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {inputs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty">
                    No inputs defined
                  </td>
                </tr>
              ) : (
                inputs.map((input) => (
                  <tr key={input.name}>
                    <td className="prop-name">{input.name}</td>
                    <td className="prop-type">
                      <code>{input.type || 'any'}</code>
                    </td>
                    <td className="prop-required">
                      <span className="required-mark">{input.required ? '✓' : '—'}</span>
                      <span className="required-word">
                        {input.required ? 'required' : 'optional'}
                      </span>
                    </td>
                    <td className="prop-desc">{input.description}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollBox>
      </div>
      <div className="section">
        <h2>Outputs</h2>
        <ScrollBox label="Outputs" className="table-scroll">
          <table className="interface-table">
            <thead>
              <tr>
                <th>Name</th>
                <th colSpan={3}>Description</th>
              </tr>
            </thead>
            <tbody>
              {outputs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty">
                    No outputs defined
                  </td>
                </tr>
              ) : (
                outputs.map((output) => (
                  <tr key={output.name}>
                    <td className="prop-name">{output.name}</td>
                    <td className="prop-desc" colSpan={3}>
                      {output.description}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollBox>
      </div>
    </div>
  );
}

export function Versions({ read, current }: { read: Read<RegistryRecord>; current: string }) {
  if (read.kind === 'loading') return <Loading what="the module's versions" />;
  const versions = read.kind === 'loaded' ? read.value.versions : [];
  return (
    <div className="tab-content active">
      <div className="section">
        <h2>Available Versions</h2>
        <p>
          {versions.length === 0 ? (
            <span className="muted">—</span>
          ) : (
            versions.map((v) => (
              <span
                key={v.version}
                className={`version-tag${v.version === current ? ' active' : ''}`}
              >
                {v.version}
              </span>
            ))
          )}
        </p>
      </div>
    </div>
  );
}

// What placing the module looks like, from its interface when it has
// loaded: the inputs and outputs, then the steps on the canvas.
export function usageExample(state: DetailState, described: ModuleInterface | undefined): string {
  const { row } = state;
  const lines = [`# ${moduleLabel(row)} (${row.system})`, `# Version: ${row.version}`];
  if (described) lines.push(`# Source: ${described.source}`);
  lines.push('');
  const { inputs, outputs } = described?.interface ?? { inputs: [], outputs: [] };
  if (inputs.length > 0) {
    lines.push('# Inputs:');
    for (const input of inputs) {
      lines.push(
        `#   ${input.name}: ${input.type || 'any'} ${input.required ? '(required)' : '(optional)'}`,
      );
    }
    lines.push('');
  }
  if (outputs.length > 0) {
    lines.push('# Outputs:');
    for (const output of outputs) lines.push(`#   ${output.name}`);
    lines.push('');
  }
  lines.push(
    '# 1. Open the module you are authoring: Cmd+Shift+P → "Lace: Open Canvas"',
    '# 2. Add this module: Add to Canvas here, or "+" in the Lace Registry',
    '# 3. Click the node to set its inputs',
    '# 4. Connect it to other modules by dragging edges',
    '# 5. Save, then Generate, from the canvas toolbar',
  );
  return lines.join('\n');
}

function Examples({
  state,
  described,
}: {
  state: DetailState;
  described: ModuleInterface | undefined;
}) {
  return (
    <div className="tab-content active">
      <div className="section">
        <h2>Usage Example</h2>
        <p className="examples-hint">
          Drop this module onto a canvas, configure its inputs, and connect it to other modules.
        </p>
        <ScrollBox label="Usage example" className="code-block">
          {usageExample(state, described)}
        </ScrollBox>
      </div>
    </div>
  );
}
