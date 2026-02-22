import React from 'react';

export type BreadcrumbProps = {
  path: string[]; // module_keys from root to active
  onNavigate: (index: number) => void; // navigate to specific depth
};

const Breadcrumb: React.FC<BreadcrumbProps> = ({ path, onNavigate }) => {
  if (path.length <= 1) return null;

  return (
    <div className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-[#1e1e1e] border border-[#333] rounded px-2 py-1 text-xs text-white shadow-md">
      {/* Back button */}
      <button
        onClick={() => onNavigate(path.length - 2)}
        className="text-[#58a6ff] hover:text-white bg-transparent border-none cursor-pointer px-1 py-0.5 text-xs"
        title="Navigate out"
      >
        ←
      </button>

      {/* Breadcrumb segments */}
      {path.map((key, index) => {
        const label = key.split('@')[0];
        const isLast = index === path.length - 1;

        return (
          <React.Fragment key={key}>
            {index > 0 && <span className="text-[#555] mx-0.5">›</span>}
            {isLast ? (
              <span className="text-white font-medium">{label}</span>
            ) : (
              <button
                onClick={() => onNavigate(index)}
                className="text-[#58a6ff] hover:text-white bg-transparent border-none cursor-pointer px-0.5 py-0 text-xs underline"
              >
                {label}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default Breadcrumb;
