import PanelFrame from '../PanelFrame';

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
      <div className="text-xs opacity-70">Connection</div>
      <div className="text-sm font-semibold mt-0.5">
        {source} → {target}
      </div>
    </div>
  );

  const footer = (
    <button
      className="w-full py-3 bg-[rgba(229,72,77,0.15)] text-[#e5484d] border border-solid border-[rgba(229,72,77,0.4)] rounded-lg font-semibold text-sm cursor-pointer"
      onClick={onDelete}
    >
      Delete connection
    </button>
  );

  return (
    <PanelFrame title={title} width={380} footer={footer} onClose={onClose}>
      <div className="text-xs opacity-80 mb-2">Wiring</div>
      <div className="font-mono text-[11px] opacity-90 mb-4">
        {source}.outputs.{sourceOutput}
        <div className="my-1 opacity-60">↓</div>
        {target}.inputs.{targetInput}
      </div>
      <div className="text-[11px] opacity-60">
        Delete or press Backspace with the edge selected to remove this connection. Create new edges
        by dragging between the pins on each node's edge.
      </div>
    </PanelFrame>
  );
}
