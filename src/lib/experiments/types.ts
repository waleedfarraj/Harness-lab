import "server-only";

import type { AgentTrajectory } from "../agent/types";
import type { SandboxHandle, SandboxRunner } from "../sandbox/types";

export interface EvaluatorContext {
  runner: SandboxRunner;
  sandbox: SandboxHandle;
  fixtureRoot: string;
  trajectory: AgentTrajectory;
}

export interface EvaluationFlags {
  buildPassed: boolean;
  publicTestsPassed: boolean;
  hiddenTestsPassed: boolean;
  relevantTestsExecuted: boolean;
}

export interface EvaluationOutcome {
  evaluation: EvaluationFlags;
  changedFiles: string[];
  diff: string;
  /** Raw evaluator command output kept for evidence; HarnessLab's booleans above are authoritative, not this. */
  raw: Record<string, unknown>;
}

export type TaskEvaluator = (ctx: EvaluatorContext) => Promise<EvaluationOutcome>;

export interface CodingTask {
  id: string;
  title: string;
  /** The instruction given to the agent. Deliberately does not name the exact implementation. */
  instruction: string;
  /** Path (relative to the repo root) to the canonical, never-mutated fixture directory. */
  fixturePath: string;
  /** Exact command strings the agent's run_command tool may execute. */
  allowedCommands: string[];
  evaluator: TaskEvaluator;
  maxTurns?: number;
  commandTimeoutMs?: number;
  experimentTimeoutMs?: number;
}

export interface ExperimentMetrics {
  agentTurns: number;
  toolCalls: number;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ExperimentResult {
  runId: string;
  taskId: string;
  success: boolean;
  evaluation: EvaluationFlags;
  changedFiles: string[];
  metrics: ExperimentMetrics;
  evidence: {
    trajectory: AgentTrajectory;
    diff: string;
    evaluatorRaw: Record<string, unknown>;
    stopReason: AgentTrajectory["stopReason"];
  };
}
