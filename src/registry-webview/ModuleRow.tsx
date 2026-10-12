// One module's row in the registry sidebar: the module itself, a button
// named by its name and version and described by its categories, which opens
// its detail and whose hit area is the whole row; then its actions side by
// side (its other versions, "+", its star); and, once expanded, its other
// versions, each with a "+" of its own. An action is named by its title, as
// VS Code's action bars name theirs, so its tooltip and its name are one;
// its glyph is hidden from screen readers.
import { useId } from 'react';
import type {
  Read,
  RegistryRow,
  RegistryVersion,
  SendSidebarMessage,
} from '../protocol/registry-protocol';
import { moduleKey, moduleLabel } from '../protocol/registry-protocol';
import { ModuleIcon } from './ModuleIcon';

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
  send: SendSidebarMessage;
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
              title={`Other versions of ${label}`}
              aria-expanded={expanded}
              onClick={onExpand}
            >
              <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
            </button>
          )}
          <button
            type="button"
            className="module-add"
            title={`Add ${label} ${row.version} to the canvas`}
            onClick={() => send({ op: 'place', key, version: row.version })}
          >
            <span aria-hidden="true">+</span>
          </button>
          <button
            type="button"
            className={`module-star${starred ? ' starred' : ''}`}
            title={`Favorite ${label}`}
            aria-pressed={starred}
            onClick={() => send({ op: 'toggleFavourite', key })}
          >
            <span aria-hidden="true">{starred ? '★' : '☆'}</span>
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
  send: SendSidebarMessage;
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
            title={`Add ${moduleLabel(row)} ${v.version} to the canvas`}
            onClick={() => send({ op: 'place', key: moduleKey(row), version: v.version })}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      ))}
    </div>
  );
}
