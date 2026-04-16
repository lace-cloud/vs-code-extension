import type { Edge } from '@xyflow/react';
import { useCallback, useState } from 'react';
import type { CanvasEngine } from '../engine';
import type { CanvasView } from '../types/render';

export type SelectedEdge = {
  id: string;
  source: string;
  target: string;
  sourceOutput: string;
  targetInput: string;
};

export function useEdgeInspector(
  engine: CanvasEngine | null,
  updateView: (view: CanvasView) => void,
) {
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdge | null>(null);

  const onEdgeClick = useCallback((_e: React.MouseEvent, edge: Edge) => {
    const sourceOutput = (edge.data?.source_output as string | undefined) ?? '';
    const targetInput = (edge.data?.target_input as string | undefined) ?? '';
    if (!sourceOutput || !targetInput) return;
    // Use original IDs for remapped edges (collapsed groups)
    setSelectedEdge({
      id: edge.id,
      source: (edge.data?.original_source as string) ?? edge.source,
      target: (edge.data?.original_target as string) ?? edge.target,
      sourceOutput,
      targetInput,
    });
  }, []);

  const onDeleteSelectedEdge = useCallback(async () => {
    if (!engine || !selectedEdge) return;
    const result = await engine.disconnect(selectedEdge.target, selectedEdge.targetInput);
    updateView(result);
    setSelectedEdge(null);
  }, [engine, selectedEdge, updateView]);

  const clearSelectedEdge = useCallback(() => setSelectedEdge(null), []);

  return { selectedEdge, onEdgeClick, onDeleteSelectedEdge, clearSelectedEdge };
}
