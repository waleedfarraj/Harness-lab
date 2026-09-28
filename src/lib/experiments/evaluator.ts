import "server-only";

import { listLocalFiles, safeReadLocalFile } from "../agent/local-fs";
import type { AgentTrajectory } from "../agent/types";
import { FIXTURE_COPY_ENTRIES } from "./fixture-copy";
import type { SandboxHandle, SandboxRunner } from "../sandbox/types";

/**
 * Deterministic evaluation helpers shared by task evaluators. HarnessLab —
 * never the model — decides pass/fail from these results.
 */

const CHECK_ENV_ALLOWLIST = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP"];

function checkEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CHECK_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

export interface CheckResult {
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs a check command directly (not through the agent's allowlist — the evaluator is privileged, the agent is not). */
export async function runCheckCommand(
  runner: SandboxRunner,
  sandbox: SandboxHandle,
  command: string,
  args: string[],
): Promise<CheckResult> {
  const result = await runner.execute(sandbox, { command, args, env: checkEnv() });
  return { passed: result.exitCode === 0, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

function isInCopiedScope(rel: string): boolean {
  const head = rel.split("/")[0];
  return (FIXTURE_COPY_ENTRIES as readonly string[]).includes(head);
}

/**
 * Files that differ (or were added/removed) between the canonical fixture
 * (always local disk) and the finished workspace (local or remote,
 * whichever SandboxRunner ran the experiment), scoped to only the entries a
 * workspace is ever seeded with (see `FIXTURE_COPY_ENTRIES`). Without this
 * scoping, fixture material that is deliberately never copied in — e.g.
 * `hidden/` — would show up as "removed", which is both wrong and a
 * hidden-test leak.
 */
export async function diffChangedFiles(runner: SandboxRunner, sandbox: SandboxHandle, fixtureRoot: string): Promise<string[]> {
  const beforeFiles = listLocalFiles(fixtureRoot).filter(isInCopiedScope);
  const before = new Map(beforeFiles.map((rel) => [rel, safeReadLocalFile(fixtureRoot, rel)]));

  const afterFiles = (await runner.listFiles(sandbox, ".")).filter(isInCopiedScope);
  const changed = new Set<string>();

  for (const rel of afterFiles) {
    let afterContent: string | null;
    try {
      afterContent = await runner.readFile(sandbox, rel);
    } catch {
      afterContent = null;
    }
    if (!before.has(rel) || before.get(rel) !== afterContent) {
      changed.add(rel);
    }
  }
  for (const rel of before.keys()) {
    if (!afterFiles.includes(rel)) changed.add(rel);
  }
  return [...changed].sort();
}

/** Did the agent's trajectory actually invoke this exact allowlisted command? */
export function wasCommandExecuted(trajectory: AgentTrajectory, command: string): boolean {
  return trajectory.turns.some((turn) =>
    turn.toolCalls.some((call) => call.name === "run_command" && call.arguments.command === command),
  );
}
