// Module detail: the header with Add to Canvas, then the tabs Details,
// Interface, Versions and Examples. Details renders the module's README;
// Interface is the certified interface `registry describe` reads, which
// loads after the header because describing a version downloads and
// certifies it.
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  DetailMessage,
  DetailState,
  ModuleInterface,
  Read,
  RegistryRecord,
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

const loaded = <T,>(read: Read<T>): T | undefined =>
  read.kind === 'loaded' ? read.value : undefined;

export function ModuleDetail({
  state,
  send,
}: {
  state: DetailState;
  send: (message: DetailMessage) => void;
}) {
  const [tab, setTab] = useState<Tab>('details');
  const { row } = state;
  const record = loaded(state.record);
  const described = loaded(state.describe);
  const description = record?.latest.description || row.description;
  return (
    <>
      <div className="header">
        <ModuleIcon vendor={record?.latest.vendor ?? row.vendor} className="header-icon" />
        <div className="header-info">
          <h1>{moduleLabel(row)}</h1>
          <div className="header-meta">
            <span className="badge">{KIND}</span>
            <span>{row.version}</span>
            <span>·</span>
            <span>{row.system.toUpperCase()}</span>
            {row.categories.length > 0 && (
              <>
                <span>·</span>
                <span>{row.categories.join(', ')}</span>
              </>
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

      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === id}
            key={id}
            className={`tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="content">
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
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{latest.readme}</ReactMarkdown>
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
      </div>
    </div>
  );
}

export function Interface({ read }: { read: Read<ModuleInterface> }) {
  if (read.kind === 'loading') return <Loading what="the module's interface" />;
  const { inputs, outputs } =
    read.kind === 'loaded' ? read.value.interface : { inputs: [], outputs: [] };
  return (
    <div className="tab-content active">
      <div className="section">
        <h2>Inputs</h2>
        <table>
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
                  <td className="prop-required">{input.required ? '✓' : '—'}</td>
                  <td className="prop-desc">{input.description}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="section">
        <h2>Outputs</h2>
        <table>
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
        <div className="code-block">{usageExample(state, described)}</div>
      </div>
    </div>
  );
}
