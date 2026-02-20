// src/webview/components/Sidebar.tsx
import React from 'react';

export interface RegistryModule {
  id: string;
  name: string;
  description?: string;
  system: string;
  version: string;
  kind: 'leaf' | 'composite';
  categories?: string[];
}

export type RegistryTree = Record<string, RegistryModule[]>;

interface SidebarProps {
  registry: RegistryTree;
}

declare global {
  interface Window {
    iconPaths: Record<string, string>;
  }
}

const Sidebar: React.FC<SidebarProps> = ({ registry }) => {
  const handleDragStart = (event: React.DragEvent, module: RegistryModule) => {
    event.dataTransfer.setData('application/lace-module', JSON.stringify(module));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="sidebar">
      <h3>Terraform Registry</h3>

      {Object.keys(registry).length === 0 && <div className="empty">No modules available</div>}

      {Object.entries(registry).map(([category, modules]) => (
        <div key={category} className="category">
          <h4>{category}</h4>

          {modules.map((mod) => (
            <div
              key={mod.id}
              className="module"
              draggable
              onDragStart={(e) => handleDragStart(e, mod)}
            >
              <img
                src={
                  window.iconPaths?.[mod.name] ??
                  window.iconPaths?.[mod.system] ??
                  window.iconPaths?.default
                }
                className="icon-image"
                alt={mod.name}
              />

              <div className="module-info">
                <div className="module-name">{mod.name}</div>
                <div className="module-version">v{mod.version}</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default Sidebar;
