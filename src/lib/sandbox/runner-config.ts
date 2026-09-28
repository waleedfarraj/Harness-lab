import "server-only";

import { LocalExperimentRunner } from "../experiments/local-runner";
import { TokenFactorySandboxRunner } from "./token-factory-runner";
import type { SandboxRunner } from "./types";

export type RunnerKind = "local" | "token-factory";

export class InvalidRunnerConfigError extends Error {
  constructor(value: string) {
    super(`HARNESSLAB_RUNNER must be "local" or "token-factory", got: "${value}"`);
    this.name = "InvalidRunnerConfigError";
  }
}

type Env = Record<string, string | undefined>;

export function resolveRunnerKind(env: Env = process.env): RunnerKind {
  const raw = (env.HARNESSLAB_RUNNER ?? "local").trim();
  if (raw === "local" || raw === "token-factory") return raw;
  throw new InvalidRunnerConfigError(raw);
}

/**
 * No silent fallback: if `token-factory` is selected, this always returns a
 * `TokenFactorySandboxRunner` — if it's unconfigured (missing
 * NEBIUS_API_KEY/NEBIUS_PROJECT_ID) or the bridge fails, its own methods
 * throw loudly. Nothing here ever quietly substitutes the local runner.
 */
export function createSandboxRunner(env: Env = process.env): SandboxRunner {
  const kind = resolveRunnerKind(env);
  return kind === "local" ? new LocalExperimentRunner() : new TokenFactorySandboxRunner();
}
