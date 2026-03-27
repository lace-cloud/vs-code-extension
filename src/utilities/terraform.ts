// src/utilities/terraform.ts
// Pure utility module for running terraform CLI commands.
// No VS Code imports — just child_process and structured results.

import { execFile } from 'node:child_process';
import path from 'node:path';

// ── Types ──

type ExecResult = { stdout: string; stderr: string; code: number };

export type ValidateDiagnostic = {
  severity: 'error' | 'warning';
  message: string;
  address?: string;
  file?: string;
  line?: number;
  column?: number;
};

export type ValidateResult = {
  valid: boolean;
  diagnostics: ValidateDiagnostic[];
};

// ── Low-level exec ──

const DEFAULT_TIMEOUT = 30_000;

function exec(args: string[], cwd: string, timeout = DEFAULT_TIMEOUT): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile('terraform', args, { cwd, timeout }, (err, stdout, stderr) => {
      const code = err && 'code' in err ? (err.code as number) : err ? 1 : 0;
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code });
    });
  });
}

// ── Public API ──

/** Check if terraform is available on PATH. */
export async function isAvailable(): Promise<boolean> {
  try {
    const { code } = await exec(['version'], '.', 5_000);
    return code === 0;
  } catch {
    return false;
  }
}

/**
 * Run `terraform fmt` on each unique directory derived from the given file paths.
 * Best-effort — errors are swallowed (formatting is cosmetic).
 */
export async function format(filePaths: string[]): Promise<void> {
  const dirs = new Set(filePaths.map((f) => path.dirname(f)));
  await Promise.all([...dirs].map((dir) => exec(['fmt'], dir).catch(() => {})));
}

/**
 * Run `terraform init -backend=false` + `terraform validate -json` in the given directory.
 * Returns structured diagnostics, or null if init/validate produced no usable output.
 */
export async function validate(dir: string): Promise<ValidateResult | null> {
  // Step 1: terraform init -backend=false
  const init = await exec(['init', '-backend=false'], dir, 60_000);
  if (init.code !== 0) return null;

  // Step 2: terraform validate -json
  const result = await exec(['validate', '-json'], dir);
  if (!result.stdout) return null;

  return parseValidateJSON(result.stdout);
}

// ── JSON parsing (mirrors Go's ParseValidateJSON) ──

type TerraformValidateJSON = {
  valid: boolean;
  diagnostics: Array<{
    severity: string;
    summary: string;
    detail: string;
    address?: string;
    range?: { filename: string; start: { line: number; column: number } };
  }>;
};

function parseValidateJSON(raw: string): ValidateResult | null {
  try {
    const parsed: TerraformValidateJSON = JSON.parse(raw);
    return {
      valid: parsed.valid,
      diagnostics: (parsed.diagnostics ?? []).map((d) => ({
        severity: d.severity as 'error' | 'warning',
        message: d.summary + (d.detail ? `: ${d.detail}` : ''),
        address: d.address,
        file: d.range?.filename,
        line: d.range?.start.line,
        column: d.range?.start.column,
      })),
    };
  } catch {
    return null;
  }
}
