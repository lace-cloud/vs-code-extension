// MockCanvasEngine — a CanvasEngine that serves a single fixture without
// any backend. Used by Flows/Mock/* stories so they render in Chromatic's
// cloud where no `lace engine` is available.
//
// Semantics:
//   - All reads return the fixture unchanged.
//   - All writes return the current fixture (no state mutation). Flow
//     stories capture a single visual moment — interaction is covered by
//     the live Flows/* stories + Playwright tests.
//   - Subscribers registered via onEvent receive an immediate
//     `stateUpdated` event so App's view mounts with the fixture.
//   - sessionGenerate emits `generateProgress` → `generateSuccess` for
//     stories that exercise the toast surface.
//
// This is NOT an attempt to replicate CLI mutation semantics — that's the
// CLI's job, not a parallel TypeScript implementation.

import type { CanvasEngine, EngineEvent, EngineEventListener, GenerateResult } from '@lace/canvas';
import type { CanvasView, EdgeConfig, NodeConfig, RenderError, SettingsConfig } from '@lace/proto';

const EMPTY_NODE_CONFIG: NodeConfig = {
  instance_id: '',
  inputs: [],
  outputs: [],
  sibling_ids: [],
  depends_on: [],
  available_variables: [],
};

const EMPTY_EDGE_CONFIG: EdgeConfig = {
  source_instance: '',
  target_instance: '',
  source_outputs: [],
  target_unbound_inputs: [],
};

const EMPTY_SETTINGS: SettingsConfig = {
  terraform: { required_version: '', required_providers: [] },
  providers: [],
  locals: [],
  environments: {},
};

export class MockCanvasEngine implements CanvasEngine {
  private listeners = new Set<EngineEventListener>();

  constructor(private readonly view: CanvasView) {}

  // ── Session ──

  async sessionOpen(): Promise<CanvasView> {
    return this.view;
  }

  async sessionSave(): Promise<{ saved: boolean }> {
    return { saved: true };
  }

  async sessionClose(): Promise<{ status: string }> {
    return { status: 'closed' };
  }

  async sessionGenerate(): Promise<GenerateResult> {
    this.emit({ type: 'generateProgress', phase: 'generating' });
    this.emit({ type: 'generateProgress', phase: 'formatting' });
    this.emit({ type: 'generateSuccess', files: ['main.tf'] });
    return { files_written: ['main.tf'], diagnostics: [] };
  }

  // ── Actions (no-ops; return current fixture) ──

  async connect(): Promise<CanvasView> {
    return this.view;
  }
  async autoConnect(): Promise<CanvasView> {
    return this.view;
  }
  async disconnect(): Promise<CanvasView> {
    return this.view;
  }
  async updateInput(): Promise<CanvasView> {
    return this.view;
  }
  async updateAllInputs(): Promise<CanvasView> {
    return this.view;
  }
  async renameInstance(): Promise<CanvasView> {
    return this.view;
  }
  async deleteInstance(): Promise<CanvasView> {
    return this.view;
  }
  async copyInstances(): Promise<CanvasView> {
    return this.view;
  }
  async syncLayout(): Promise<void> {}
  async setVariables(): Promise<CanvasView> {
    return this.view;
  }
  async setExports(): Promise<CanvasView> {
    return this.view;
  }
  async setTerraform(): Promise<void> {}
  async setProviders(): Promise<void> {}
  async setLocals(): Promise<CanvasView> {
    return this.view;
  }
  async setDependsOn(): Promise<void> {}
  async setEnvironments(): Promise<void> {}
  async undo(): Promise<CanvasView> {
    return this.view;
  }
  async redo(): Promise<CanvasView> {
    return this.view;
  }
  async createGroup(): Promise<CanvasView> {
    return this.view;
  }
  async updateGroup(): Promise<CanvasView> {
    return this.view;
  }
  async deleteGroup(): Promise<CanvasView> {
    return this.view;
  }

  // ── Queries ──

  async queryNodeConfig(instanceId: string): Promise<NodeConfig> {
    return { ...EMPTY_NODE_CONFIG, instance_id: instanceId };
  }
  async queryEdgeConfig(source: string, target: string): Promise<EdgeConfig> {
    return { ...EMPTY_EDGE_CONFIG, source_instance: source, target_instance: target };
  }
  async querySettings(): Promise<SettingsConfig> {
    return EMPTY_SETTINGS;
  }
  async queryGraphSummary(): Promise<{ text: string }> {
    return { text: `${this.view.nodes.length} nodes, ${this.view.edges.length} edges` };
  }
  async queryValidate(): Promise<{ errors: RenderError[] }> {
    return { errors: this.view.errors };
  }

  // ── Events ──

  onEvent(listener: EngineEventListener): () => void {
    this.listeners.add(listener);
    // Emit the initial view on the next microtask so React subscribers
    // always observe the fixture even when subscription happens after
    // construction. Chromatic snapshots are static, so a single emit is
    // enough — no need to replay on every subscribe.
    queueMicrotask(() => listener({ type: 'stateUpdated', view: this.view }));
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Fire a synthetic event. Scene stories use this to drive the canvas
   * into specific UI states (toast visible, banner showing, etc.)
   * without exercising real mutations.
   */
  emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
