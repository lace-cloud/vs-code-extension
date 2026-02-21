import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type ComponentRecord = { name: string; workspace_state?: any };

type StoreData = { components: ComponentRecord[] };

/**
 * JSON-file persistence in `context.globalStorageUri`.
 * No native dependencies — zero electron-rebuild or ABI issues.
 */
export class Store {
  private readonly filePath: string;

  constructor(globalStorageUri: vscode.Uri) {
    const dir = globalStorageUri.fsPath;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.filePath = path.join(dir, 'store.json');
  }

  /* ── Read / Write ── */

  private read(): StoreData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(raw) as StoreData;
      }
    } catch {
      // Corrupt file — start fresh
    }
    return { components: [] };
  }

  private write(data: StoreData): void {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /* ── Public API ── */

  listComponents(): ComponentRecord[] {
    return this.read().components;
  }

  getComponent(name: string): ComponentRecord | undefined {
    return this.read().components.find((c) => c.name === name);
  }

  addComponent(name: string): void {
    const data = this.read();
    if (data.components.some((c) => c.name === name)) {
      return; // already exists
    }
    data.components.push({ name });
    this.write(data);
  }

  saveWorkspaceState(name: string, state: any): void {
    const data = this.read();
    const component = data.components.find((c) => c.name === name);
    if (component) {
      component.workspace_state = state;
      this.write(data);
    }
  }

  removeComponent(name: string): void {
    const data = this.read();
    data.components = data.components.filter((c) => c.name !== name);
    this.write(data);
  }
}
