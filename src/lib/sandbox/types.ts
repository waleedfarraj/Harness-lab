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
  /** Local-runner-specific: canonical fixture directory to seed the workspace from. */
  fixturePath?: string;
}

export interface SandboxHandle {
  id: string;
  /**
   * Absolute local filesystem path backing this sandbox, for runners that
   * are themselves local-filesystem-based (e.g. LocalExperimentRunner).
   * Undefined for runners with no local filesystem view, such as a future
   * Token Factory Sandbox adapter.
   */
  root?: string;
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
  /** True if the command was killed for exceeding its timeout. */
  timedOut?: boolean;
}

export interface SandboxRunner {
  create(options?: SandboxCreateOptions): Promise<SandboxHandle>;
  execute(sandbox: SandboxHandle, command: SandboxCommand): Promise<SandboxExecResult>;
  destroy(sandbox: SandboxHandle): Promise<void>;
}
