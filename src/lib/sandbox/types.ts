/**
 * HarnessLab's execution boundary for running a coding agent in isolation.
 *
 * These types describe what HarnessLab needs from a sandbox: a place to
 * execute commands and read/write files, isolated per experiment. As of
 * Milestone 3.5, both `LocalExperimentRunner` and the real
 * `TokenFactorySandboxRunner` (Token Factory Sandboxes, via the Contree
 * Python SDK) implement this same contract — `runExperiment()` and the
 * coding-agent tools never know which one they're talking to.
 */

export interface SandboxCreateOptions {
  /** Human-readable label for logs, e.g. an experiment arm id. */
  label?: string;
  /** Canonical fixture directory to seed the workspace from. */
  fixturePath?: string;
}

export interface SandboxHandle {
  id: string;
  /**
   * Absolute local filesystem path backing this sandbox, for runners that
   * are themselves local-filesystem-based (e.g. LocalExperimentRunner).
   * Undefined for remote runners.
   */
  root?: string;
  /**
   * Remote continuation state, for runners with no local filesystem view
   * (e.g. a Contree checkpoint/image UUID). The runner mutates this field on
   * the SAME handle object after any operation that changes filesystem
   * state — callers must keep reusing the same handle instance for one
   * experiment, not treat it as an immutable snapshot. Undefined for local
   * runners.
   */
  checkpoint?: string;
  /** Runner-specific, non-authoritative metadata for evidence (e.g. base OCI image). Never fabricated; absent if unavailable. */
  metadata?: Record<string, unknown>;
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
  /** Runner-specific, non-authoritative metadata for evidence (e.g. new checkpoint id, resource metrics if the runner provides them). */
  metadata?: Record<string, unknown>;
}

export interface SandboxRunner {
  create(options?: SandboxCreateOptions): Promise<SandboxHandle>;
  /**
   * Creates a new, independent handle starting from `base`'s current state,
   * without redoing `create()`'s setup (fixture copy, dependency install,
   * git init). For a remote checkpoint-based runner this is effectively
   * free — Contree's own branching model already means multiple operations
   * starting from the same checkpoint are independent (see Milestone 3.5's
   * branch spike); for a local, filesystem-based runner it's a directory
   * copy. `base` itself is left untouched and must still be destroyed by
   * its own creator.
   */
  forkFrom(base: SandboxHandle, label?: string): Promise<SandboxHandle>;
  execute(sandbox: SandboxHandle, command: SandboxCommand): Promise<SandboxExecResult>;
  listFiles(sandbox: SandboxHandle, dir: string): Promise<string[]>;
  readFile(sandbox: SandboxHandle, path: string): Promise<string>;
  writeFile(sandbox: SandboxHandle, path: string, content: string): Promise<void>;
  destroy(sandbox: SandboxHandle): Promise<void>;
}
