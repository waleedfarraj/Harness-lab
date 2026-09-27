/**
 * HarnessLab's execution boundary for running a coding agent in isolation.
 *
 * These types describe what HarnessLab needs from a sandbox. They are NOT a
 * model of the Token Factory Sandbox API, which is not yet available to us.
 * A concrete adapter maps these calls onto the real API once documented.
 */

export interface SandboxCreateOptions {
  /** Human-readable label for logs, e.g. an experiment arm id. */
  label?: string;
}

export interface SandboxHandle {
  id: string;
}

export interface SandboxCommand {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface SandboxExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface SandboxRunner {
  create(options?: SandboxCreateOptions): Promise<SandboxHandle>;
  execute(sandbox: SandboxHandle, command: SandboxCommand): Promise<SandboxExecResult>;
  destroy(sandbox: SandboxHandle): Promise<void>;
}
