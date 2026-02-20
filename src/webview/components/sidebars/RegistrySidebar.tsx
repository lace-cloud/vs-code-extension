import React from 'react';

/* ---------------------------------- */
/* Types                              */
/* ---------------------------------- */

export type RegistryModule = {
  id: string;
  name: string;
  system: string;
  version: string;
  kind: 'leaf' | 'composite';
  categories?: string[];
};

export type RegistryTree = {
  [system: string]: {
    [category: string]: RegistryModule[];
  };
};

/* ---------------------------------- */
/* Component                          */
/* ---------------------------------- */

interface RegistrySidebarProps {
  registryTree: RegistryTree;
}

const RegistrySidebar: React.FC<RegistrySidebarProps> = ({ registryTree }) => {
  return (
    <div style={{ width: 300, padding: 8, borderRight: '1px solid #333', overflowY: 'auto' }}>
      {Object.keys(registryTree).length === 0 && (
        <div style={{ opacity: 0.6 }}>No modules available</div>
      )}

      {Object.entries(registryTree).map(([system, categories]) => (
        <div key={system} style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 6 }}>
            {system}
          </div>

          {Object.entries(categories).map(([category, modules]) => (
            <details
              key={category}
              open
              className="ml-2 border border-[#444] rounded-md p-2 mb-2 hover:bg-[#2d2d2d] transition-colors"
            >
              <summary className="cursor-pointer font-medium">{category}</summary>

              {modules.map((m) => (
                <div
                  key={m.id}
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData('application/reactflow', JSON.stringify(m))
                  }
                  style={{ marginLeft: 20, padding: '4px 6px', cursor: 'grab' }}
                >
                  {m.kind === 'composite' ? '📦-📦' : '📦'} {m.name}{' '}
                  <span className="opacity-60">v{m.version}</span>
                </div>
              ))}
            </details>
          ))}
        </div>
      ))}
    </div>
  );
};

export default RegistrySidebar;
