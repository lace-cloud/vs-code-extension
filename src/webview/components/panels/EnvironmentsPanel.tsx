// src/webview/components/panels/EnvironmentsPanel.tsx
import React, { useState, useCallback } from 'react';
import type { BackendConfig } from '../../types/ir';

// ── Shared styles ──

const inputClasses =
  'w-full bg-[#0f0f0f] text-white border border-[#333] rounded-lg px-2.5 py-2.5 text-xs';

const tabClasses =
  'px-3 py-1.5 text-xs cursor-pointer border-none rounded-t-md transition-colors duration-100';

const BACKEND_TYPES = ['s3', 'gcs', 'azurerm', 'local', 'remote'];

// ── Local editing state ──

type EnvVarEntry = { key: string; value: string };
type EnvRow = { name: string; vars: EnvVarEntry[] };
type BackendRow = {
  envName: string;
  type: string;
  config: Array<{ key: string; value: string }>;
};

function toEnvRows(envs: Record<string, Record<string, any>> | undefined): EnvRow[] {
  if (!envs) return [];
  return Object.entries(envs).map(([name, vars]) => ({
    name,
    vars: Object.entries(vars).map(([key, value]) => ({
      key,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    })),
  }));
}

function toBackendRows(backends: Record<string, BackendConfig> | undefined): BackendRow[] {
  if (!backends) return [];
  return Object.entries(backends).map(([envName, backend]) => ({
    envName,
    type: backend.type,
    config: Object.entries(backend.config).map(([key, value]) => ({
      key,
      value: typeof value === 'boolean' ? String(value) : String(value),
    })),
  }));
}

function fromEnvRows(rows: EnvRow[]): Record<string, Record<string, any>> {
  const result: Record<string, Record<string, any>> = {};
  for (const row of rows) {
    if (!row.name.trim()) continue;
    const vars: Record<string, any> = {};
    for (const v of row.vars) {
      if (!v.key.trim()) continue;
      // Try parsing JSON for complex values
      try {
        vars[v.key.trim()] = JSON.parse(v.value);
      } catch {
        // Try number
        if (/^\d+$/.test(v.value)) vars[v.key.trim()] = Number(v.value);
        else vars[v.key.trim()] = v.value;
      }
    }
    result[row.name.trim()] = vars;
  }
  return result;
}

function fromBackendRows(rows: BackendRow[]): Record<string, BackendConfig> {
  const result: Record<string, BackendConfig> = {};
  for (const row of rows) {
    if (!row.envName.trim()) continue;
    const config: Record<string, any> = {};
    for (const c of row.config) {
      if (!c.key.trim()) continue;
      if (c.value === 'true') config[c.key.trim()] = true;
      else if (c.value === 'false') config[c.key.trim()] = false;
      else if (/^\d+$/.test(c.value)) config[c.key.trim()] = Number(c.value);
      else config[c.key.trim()] = c.value;
    }
    result[row.envName.trim()] = { type: row.type, config };
  }
  return result;
}

// ── Content-only component (used by UnifiedSettingsPanel) ──

type ContentProps = {
  environments: Record<string, Record<string, any>> | undefined;
  environment_backends: Record<string, BackendConfig> | undefined;
  onSave: (
    environments: Record<string, Record<string, any>>,
    backends: Record<string, BackendConfig>,
  ) => void;
};

export function EnvironmentsContent({ environments, environment_backends, onSave }: ContentProps) {
  const [activeTab, setActiveTab] = useState<'environments' | 'backends'>('environments');
  const [envRows, setEnvRows] = useState<EnvRow[]>(() => toEnvRows(environments));
  const [backendRows, setBackendRows] = useState<BackendRow[]>(() =>
    toBackendRows(environment_backends),
  );

  // ── Environment editing ──

  const addEnv = useCallback(() => {
    setEnvRows((prev) => [...prev, { name: '', vars: [{ key: '', value: '' }] }]);
  }, []);

  const removeEnv = useCallback((index: number) => {
    setEnvRows((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateEnvName = useCallback((index: number, name: string) => {
    setEnvRows((prev) => prev.map((r, i) => (i === index ? { ...r, name } : r)));
  }, []);

  const addEnvVar = useCallback((envIndex: number) => {
    setEnvRows((prev) =>
      prev.map((r, i) =>
        i === envIndex ? { ...r, vars: [...r.vars, { key: '', value: '' }] } : r,
      ),
    );
  }, []);

  const removeEnvVar = useCallback((envIndex: number, varIndex: number) => {
    setEnvRows((prev) =>
      prev.map((r, i) =>
        i === envIndex ? { ...r, vars: r.vars.filter((_, vi) => vi !== varIndex) } : r,
      ),
    );
  }, []);

  const updateEnvVar = useCallback(
    (envIndex: number, varIndex: number, field: 'key' | 'value', value: string) => {
      setEnvRows((prev) =>
        prev.map((r, i) =>
          i === envIndex
            ? {
                ...r,
                vars: r.vars.map((v, vi) => (vi === varIndex ? { ...v, [field]: value } : v)),
              }
            : r,
        ),
      );
    },
    [],
  );

  // ── Backend editing ──

  const addBackend = useCallback(() => {
    setBackendRows((prev) => [
      ...prev,
      { envName: '', type: 's3', config: [{ key: '', value: '' }] },
    ]);
  }, []);

  const removeBackend = useCallback((index: number) => {
    setBackendRows((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateBackendEnvName = useCallback((index: number, envName: string) => {
    setBackendRows((prev) => prev.map((r, i) => (i === index ? { ...r, envName } : r)));
  }, []);

  const updateBackendType = useCallback((index: number, type: string) => {
    setBackendRows((prev) => prev.map((r, i) => (i === index ? { ...r, type } : r)));
  }, []);

  const addBackendConfig = useCallback((backendIndex: number) => {
    setBackendRows((prev) =>
      prev.map((r, i) =>
        i === backendIndex ? { ...r, config: [...r.config, { key: '', value: '' }] } : r,
      ),
    );
  }, []);

  const removeBackendConfig = useCallback((backendIndex: number, configIndex: number) => {
    setBackendRows((prev) =>
      prev.map((r, i) =>
        i === backendIndex ? { ...r, config: r.config.filter((_, ci) => ci !== configIndex) } : r,
      ),
    );
  }, []);

  const updateBackendConfig = useCallback(
    (backendIndex: number, configIndex: number, field: 'key' | 'value', value: string) => {
      setBackendRows((prev) =>
        prev.map((r, i) =>
          i === backendIndex
            ? {
                ...r,
                config: r.config.map((c, ci) =>
                  ci === configIndex ? { ...c, [field]: value } : c,
                ),
              }
            : r,
        ),
      );
    },
    [],
  );

  // ── Save ──

  const handleSave = () => {
    onSave(fromEnvRows(envRows), fromBackendRows(backendRows));
  };

  return (
    <>
      {/* Tabs */}
      <div className="flex border-b border-[#333] mb-3 -mx-4 px-4">
        <button
          className={`${tabClasses} ${activeTab === 'environments' ? 'bg-[#1e1e1e] text-white' : 'bg-transparent text-[#999]'}`}
          onClick={() => setActiveTab('environments')}
        >
          Environments
        </button>
        <button
          className={`${tabClasses} ${activeTab === 'backends' ? 'bg-[#1e1e1e] text-white' : 'bg-transparent text-[#999]'}`}
          onClick={() => setActiveTab('backends')}
        >
          Backends
        </button>
      </div>

      {activeTab === 'environments' && (
        <>
          {envRows.map((env, ei) => (
            <div key={ei} className="mb-4 p-3 bg-[#0f0f0f] border border-[#333] rounded-lg">
              <div className="flex gap-2 mb-2">
                <input
                  value={env.name}
                  onChange={(e) => updateEnvName(ei, e.target.value)}
                  placeholder="Environment name (e.g. dev)"
                  className={`${inputClasses} flex-1 font-bold`}
                />
                <button
                  onClick={() => removeEnv(ei)}
                  className="text-[#e5484d] text-xs px-2 cursor-pointer bg-transparent border-none"
                >
                  ✕
                </button>
              </div>

              <div className="text-[11px] opacity-70 mb-2">Variable overrides</div>
              {env.vars.map((v, vi) => (
                <div key={vi} className="flex gap-2 mb-1.5">
                  <input
                    value={v.key}
                    onChange={(e) => updateEnvVar(ei, vi, 'key', e.target.value)}
                    placeholder="Variable name"
                    className={`${inputClasses} flex-1`}
                  />
                  <input
                    value={v.value}
                    onChange={(e) => updateEnvVar(ei, vi, 'value', e.target.value)}
                    placeholder="Value"
                    className={`${inputClasses} flex-1`}
                  />
                  <button
                    onClick={() => removeEnvVar(ei, vi)}
                    className="text-[#e5484d] text-[10px] px-1.5 cursor-pointer bg-transparent border-none"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => addEnvVar(ei)}
                className="text-[10px] text-[#1f6feb] cursor-pointer bg-transparent border-none mt-1"
              >
                + Add variable
              </button>
            </div>
          ))}
          <button
            onClick={addEnv}
            className="text-xs text-[#1f6feb] cursor-pointer bg-transparent border-none mb-4"
          >
            + Add environment
          </button>
        </>
      )}

      {activeTab === 'backends' && (
        <>
          {backendRows.map((b, bi) => (
            <div key={bi} className="mb-4 p-3 bg-[#0f0f0f] border border-[#333] rounded-lg">
              <div className="flex gap-2 mb-2">
                <input
                  value={b.envName}
                  onChange={(e) => updateBackendEnvName(bi, e.target.value)}
                  placeholder="Environment name"
                  className={`${inputClasses} flex-1 font-bold`}
                />
                <select
                  value={b.type}
                  onChange={(e) => updateBackendType(bi, e.target.value)}
                  className={`${inputClasses} flex-1`}
                >
                  {BACKEND_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => removeBackend(bi)}
                  className="text-[#e5484d] text-xs px-2 cursor-pointer bg-transparent border-none"
                >
                  ✕
                </button>
              </div>

              <div className="text-[11px] opacity-70 mb-2">Config</div>
              {b.config.map((c, ci) => (
                <div key={ci} className="flex gap-2 mb-1.5">
                  <input
                    value={c.key}
                    onChange={(e) => updateBackendConfig(bi, ci, 'key', e.target.value)}
                    placeholder="Key"
                    className={`${inputClasses} flex-1`}
                  />
                  <input
                    value={c.value}
                    onChange={(e) => updateBackendConfig(bi, ci, 'value', e.target.value)}
                    placeholder="Value"
                    className={`${inputClasses} flex-1`}
                  />
                  <button
                    onClick={() => removeBackendConfig(bi, ci)}
                    className="text-[#e5484d] text-[10px] px-1.5 cursor-pointer bg-transparent border-none"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => addBackendConfig(bi)}
                className="text-[10px] text-[#1f6feb] cursor-pointer bg-transparent border-none mt-1"
              >
                + Add config key
              </button>
            </div>
          ))}
          <button
            onClick={addBackend}
            className="text-xs text-[#1f6feb] cursor-pointer bg-transparent border-none mb-4"
          >
            + Add backend
          </button>
        </>
      )}

      {/* Inline save */}
      <button
        className="w-full py-2.5 bg-[#1f6feb] text-white border-none rounded-[10px] font-bold text-sm cursor-pointer mt-2"
        onClick={handleSave}
      >
        Save environments
      </button>
    </>
  );
}

// ── Full panel (backwards compat — original default export) ──

type Props = {
  environments: Record<string, Record<string, any>> | undefined;
  environment_backends: Record<string, BackendConfig> | undefined;
  onSave: (
    environments: Record<string, Record<string, any>>,
    backends: Record<string, BackendConfig>,
  ) => void;
  onClose: () => void;
};

export default function EnvironmentsPanel({
  environments,
  environment_backends,
  onSave,
  onClose,
}: Props) {
  return (
    <div className="w-[420px] h-full bg-[#1e1e1e] border-l border-[#333] flex flex-col">
      <header className="p-4 border-b border-[#333] flex justify-between items-center shrink-0">
        <h3 className="m-0 text-base">Environments</h3>
        <button
          onClick={onClose}
          className="cursor-pointer border border-[#333] bg-[#0f0f0f] text-white rounded-lg w-[34px] h-[34px]"
          aria-label="Close"
        >
          ✕
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        <EnvironmentsContent
          environments={environments}
          environment_backends={environment_backends}
          onSave={onSave}
        />
      </div>
    </div>
  );
}
