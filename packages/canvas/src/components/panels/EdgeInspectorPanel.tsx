import { Panel } from '@lace/ui';
import './EdgeInspectorPanel.css';

type Props = {
  source: string;
  target: string;
  sourceOutput: string;
  targetInput: string;
  onDelete: () => void;
  onClose: () => void;
};

export default function EdgeInspectorPanel({
  source,
  target,
  sourceOutput,
  targetInput,
  onDelete,
  onClose,
}: Props) {
  const title = (
    <div>
      <div className="lace-edge-panel__title-eyebrow">Connection</div>
      <div className="lace-edge-panel__title">
        {source} → {target}
      </div>
    </div>
  );

  const footer = (
    <button type="button" className="lace-edge-panel__delete-btn" onClick={onDelete}>
      Delete connection
    </button>
  );

  return (
    <Panel title={title} width={380} footer={footer} onClose={onClose}>
      <div className="lace-edge-panel__section-label">Wiring</div>
      <div className="lace-edge-panel__wiring">
        {source}.outputs.{sourceOutput}
        <div className="lace-edge-panel__wiring-arrow">↓</div>
        {target}.inputs.{targetInput}
      </div>
      <div className="lace-edge-panel__hint">
        Delete or press Backspace with the edge selected to remove this connection. Create new edges
        by dragging between the pins on each node's edge.
      </div>
    </Panel>
  );
}
