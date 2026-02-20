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
    <div className="w-[300px] p-2 border-r border-[#333] overflow-y-auto">
      {Object.keys(registryTree).length === 0 && (
        <div className="opacity-60">No modules available</div>
      )}

      {Object.entries(registryTree).map(([system, categories]) => (
        <div key={system} className="mb-3.5">
          <div className="font-bold uppercase mb-1.5">{system}</div>

          {Object.entries(categories).map(([category, modules]) => (
            <details
              key={category}
              open
              className="ml-2 border border-[#444] rounded-md p-2 mb-2 transition-colors"
            >
              <summary className="cursor-pointer font-medium">{category}</summary>

              {modules.map((m) => (
                <div
                  key={m.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/reactflow', JSON.stringify(m));
                    (e.currentTarget as HTMLElement).style.cursor = 'grabbing';
                  }}
                  onDragEnd={(e) => {
                    (e.currentTarget as HTMLElement).style.cursor = 'grab';
                  }}
                  className="rounded-md transition-colors hover:bg-[#2d2d2d] active:cursor-grabbing ml-5 p-2 border border-[#444] mt-2 cursor-grab"
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
